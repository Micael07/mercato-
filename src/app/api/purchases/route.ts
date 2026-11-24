import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
  users,
  companySettings,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { roundMoney, toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "purchases.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim();

  const conds = [
    eq(purchaseOrders.companyId, ctx.company.id),
    eq(purchaseOrders.establishmentId, ctx.establishment.id),
  ];
  if (status && status !== "all") conds.push(eq(purchaseOrders.status, status));

  const rows = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.tradeName,
      supplierLegalName: suppliers.legalName,
      status: purchaseOrders.status,
      subtotal: purchaseOrders.subtotal,
      discount: purchaseOrders.discount,
      freight: purchaseOrders.freight,
      taxes: purchaseOrders.taxes,
      total: purchaseOrders.total,
      paymentTerms: purchaseOrders.paymentTerms,
      expectedDelivery: purchaseOrders.expectedDelivery,
      createdByName: users.name,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
    .where(and(...conds))
    .orderBy(desc(purchaseOrders.createdAt));

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      subtotal: toNumber(r.subtotal),
      discount: toNumber(r.discount),
      freight: toNumber(r.freight),
      taxes: toNumber(r.taxes),
      total: toNumber(r.total),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const supplierId = String(body?.supplierId ?? "");
  const items: Array<{
    productId: string;
    quantityOrdered: number;
    unitCost: number;
    discount?: number;
  }> = Array.isArray(body?.items) ? body.items : [];

  if (!supplierId || items.length === 0) {
    return NextResponse.json(
      { error: "Selecione fornecedor e ao menos um produto." },
      { status: 400 }
    );
  }

  const created = await db.transaction(async (tx) => {
    const [settings] = await tx
      .update(companySettings)
      .set({ nextPurchaseNumber: sql`${companySettings.nextPurchaseNumber} + 1` })
      .where(eq(companySettings.companyId, ctx.company.id))
      .returning();

    const orderNumber = (settings?.nextPurchaseNumber ?? 102) - 1;

    let subtotal = 0;
    const prepared = items.map((i) => {
      const qty = toNumber(i.quantityOrdered);
      const cost = toNumber(i.unitCost);
      const disc = roundMoney(toNumber(i.discount ?? 0));
      const lineTotal = roundMoney(qty * cost - disc);
      subtotal = roundMoney(subtotal + lineTotal);
      return { ...i, qty, cost, disc, lineTotal };
    });

    const discount = roundMoney(toNumber(body?.discount ?? 0));
    const freight = roundMoney(toNumber(body?.freight ?? 0));
    const taxes = roundMoney(toNumber(body?.taxes ?? 0));
    const total = roundMoney(subtotal - discount + freight + taxes);

    const status = String(body?.status ?? "approved");

    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        supplierId,
        orderNumber,
        status,
        subtotal: subtotal.toFixed(2),
        discount: discount.toFixed(2),
        freight: freight.toFixed(2),
        taxes: taxes.toFixed(2),
        total: total.toFixed(2),
        paymentTerms: body?.paymentTerms ? String(body.paymentTerms) : null,
        expectedDelivery: body?.expectedDelivery || null,
        notes: body?.notes ? String(body.notes) : null,
        createdBy: ctx.user.id,
        approvedBy: status === "approved" ? ctx.user.id : null,
      })
      .returning();

    await tx.insert(purchaseOrderItems).values(
      prepared.map((i) => ({
        purchaseOrderId: po.id,
        productId: i.productId,
        quantityOrdered: i.qty.toFixed(3),
        quantityReceived: "0.000",
        unitCost: i.cost.toFixed(4),
        discount: i.disc.toFixed(2),
        total: i.lineTotal.toFixed(2),
      }))
    );

    await recordAudit(
      {
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        action: "purchase_order_created",
        entity: "purchase_order",
        entityId: po.id,
        newData: { orderNumber, total, status },
      },
      tx as unknown as typeof db
    );

    return po;
  });

  return NextResponse.json({ item: created }, { status: 201 });
}
