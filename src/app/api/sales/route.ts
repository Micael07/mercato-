import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  sales,
  saleItems,
  salePayments,
  customers,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { completeSaleTx, DomainError } from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "sales.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  const conditions = [
    eq(sales.companyId, ctx.company.id),
    eq(sales.establishmentId, ctx.establishment.id),
  ];
  if (status && status !== "all") conditions.push(eq(sales.status, status));
  if (from) conditions.push(gte(sales.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conditions.push(lte(sales.createdAt, new Date(`${to}T23:59:59`)));

  const rows = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      customerId: sales.customerId,
      customerName: customers.name,
      operatorId: sales.operatorId,
      operatorName: users.name,
      status: sales.status,
      subtotal: sales.subtotal,
      discountTotal: sales.discountTotal,
      surchargeTotal: sales.surchargeTotal,
      total: sales.total,
      changeAmount: sales.changeAmount,
      notes: sales.notes,
      cancelReason: sales.cancelReason,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.operatorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(200);

  const saleIds = rows.map((r) => r.id);
  const pays =
    saleIds.length > 0
      ? await db
          .select()
          .from(salePayments)
          .where(inArray(salePayments.saleId, saleIds))
      : [];

  const paysBySale = new Map<string, typeof pays>();
  for (const p of pays) {
    const arr = paysBySale.get(p.saleId) ?? [];
    arr.push(p);
    paysBySale.set(p.saleId, arr);
  }

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      subtotal: toNumber(r.subtotal),
      discountTotal: toNumber(r.discountTotal),
      surchargeTotal: toNumber(r.surchargeTotal),
      total: toNumber(r.total),
      changeAmount: toNumber(r.changeAmount),
      payments: (paysBySale.get(r.id) ?? []).map((p) => ({
        name: p.paymentMethodName,
        code: p.paymentMethodCode,
        amount: toNumber(p.amount),
        installments: p.installments,
      })),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "sales.create");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  try {
    const body = await req.json();
    const created = await completeSaleTx({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      operatorId: ctx.user.id,
      operatorName: ctx.user.name,
      operatorRole: ctx.membership.roleCode,
      operatorMaxDiscountPercent: ctx.membership.maxDiscountPercent,
      customerId: body?.customerId || null,
      cashRegisterId: body?.cashRegisterId || null,
      items: Array.isArray(body?.items) ? body.items : [],
      payments: Array.isArray(body?.payments) ? body.payments : [],
      discountTotal: toNumber(body?.discountTotal ?? 0),
      surchargeTotal: toNumber(body?.surchargeTotal ?? 0),
      notes: body?.notes ? String(body.notes) : undefined,
      status: body?.status === "suspended" ? "suspended" : "completed",
      suspendedSaleId: body?.suspendedSaleId || null,
    });

    const items = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, created.id));
    const payments = await db
      .select()
      .from(salePayments)
      .where(eq(salePayments.saleId, created.id));

    return NextResponse.json(
      {
        sale: {
          ...created,
          subtotal: toNumber(created.subtotal),
          discountTotal: toNumber(created.discountTotal),
          surchargeTotal: toNumber(created.surchargeTotal),
          total: toNumber(created.total),
          changeAmount: toNumber(created.changeAmount),
        },
        items: items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productName: i.productName,
          sku: i.sku,
          quantity: toNumber(i.quantity),
          unitPrice: toNumber(i.unitPrice),
          discountAmount: toNumber(i.discountAmount),
          total: toNumber(i.total),
        })),
        payments: payments.map((p) => ({
          id: p.id,
          paymentMethodName: p.paymentMethodName,
          paymentMethodCode: p.paymentMethodCode,
          amount: toNumber(p.amount),
          installments: p.installments,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Complete sale error:", err);
    return NextResponse.json(
      { error: "Erro ao registrar venda." },
      { status: 500 }
    );
  }
}
