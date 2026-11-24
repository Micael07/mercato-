import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  financialEntries,
  financialCategories,
  financialSettlements,
  suppliers,
  customers,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { roundMoney, toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "finance.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type")?.trim(); // payable | receivable
  const status = searchParams.get("status")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  const conds = [
    eq(financialEntries.companyId, ctx.company.id),
    eq(financialEntries.establishmentId, ctx.establishment.id),
  ];
  if (type && type !== "all") conds.push(eq(financialEntries.type, type));
  if (status && status !== "all") conds.push(eq(financialEntries.status, status));
  if (from) conds.push(gte(financialEntries.dueDate, from));
  if (to) conds.push(lte(financialEntries.dueDate, to));

  const rows = await db
    .select({
      id: financialEntries.id,
      type: financialEntries.type,
      originType: financialEntries.originType,
      description: financialEntries.description,
      competenceDate: financialEntries.competenceDate,
      issueDate: financialEntries.issueDate,
      dueDate: financialEntries.dueDate,
      amount: financialEntries.amount,
      interest: financialEntries.interest,
      penalty: financialEntries.penalty,
      discount: financialEntries.discount,
      paidAmount: financialEntries.paidAmount,
      status: financialEntries.status,
      paymentMethodCode: financialEntries.paymentMethodCode,
      recurrence: financialEntries.recurrence,
      supplierName: suppliers.tradeName,
      customerName: customers.name,
      categoryName: financialCategories.name,
      categoryId: financialEntries.categoryId,
    })
    .from(financialEntries)
    .leftJoin(suppliers, eq(financialEntries.supplierId, suppliers.id))
    .leftJoin(customers, eq(financialEntries.customerId, customers.id))
    .leftJoin(
      financialCategories,
      eq(financialEntries.categoryId, financialCategories.id)
    )
    .where(and(...conds))
    .orderBy(asc(financialEntries.dueDate));

  const categories = await db
    .select()
    .from(financialCategories)
    .where(eq(financialCategories.companyId, ctx.company.id))
    .orderBy(asc(financialCategories.name));

  const settlements = await db
    .select()
    .from(financialSettlements)
    .where(eq(financialSettlements.companyId, ctx.company.id))
    .orderBy(desc(financialSettlements.settledAt))
    .limit(100);

  const today = new Date().toISOString().slice(0, 10);
  const formatted = rows.map((r) => {
    const isOverdue =
      (r.status === "open" || r.status === "partial") && r.dueDate < today;
    return {
      ...r,
      effectiveStatus: isOverdue ? "overdue" : r.status,
      amount: toNumber(r.amount),
      interest: toNumber(r.interest),
      penalty: toNumber(r.penalty),
      discount: toNumber(r.discount),
      paidAmount: toNumber(r.paidAmount),
      remainingAmount: roundMoney(
        Math.max(0, toNumber(r.amount) - toNumber(r.paidAmount))
      ),
    };
  });

  // Cash flow summary
  const realizedIn = formatted
    .filter((e) => e.type === "receivable" && e.status !== "cancelled")
    .reduce((a, e) => a + e.paidAmount, 0);
  const realizedOut = formatted
    .filter((e) => e.type === "payable" && e.status !== "cancelled")
    .reduce((a, e) => a + e.paidAmount, 0);
  const projectedIn = formatted
    .filter((e) => e.type === "receivable" && e.status !== "cancelled")
    .reduce((a, e) => a + e.remainingAmount, 0);
  const projectedOut = formatted
    .filter((e) => e.type === "payable" && e.status !== "cancelled")
    .reduce((a, e) => a + e.remainingAmount, 0);

  return NextResponse.json({
    items: formatted,
    categories,
    settlements: settlements.map((s) => ({
      ...s,
      amount: toNumber(s.amount),
    })),
    summary: {
      realizedIn,
      realizedOut,
      realizedBalance: roundMoney(realizedIn - realizedOut),
      projectedIn,
      projectedOut,
      projectedBalance: roundMoney(realizedIn - realizedOut + projectedIn - projectedOut),
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "finance.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();

  if (body?.kind === "category") {
    const name = String(body?.name ?? "").trim();
    const type = body?.type === "income" ? "income" : "expense";
    if (!name) {
      return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });
    }
    const [cat] = await db
      .insert(financialCategories)
      .values({
        companyId: ctx.company.id,
        name,
        type,
        groupName: body?.groupName ? String(body.groupName) : null,
      })
      .returning();
    return NextResponse.json({ category: cat }, { status: 201 });
  }

  const description = String(body?.description ?? "").trim();
  const type = body?.type === "receivable" ? "receivable" : "payable";
  const amount = toNumber(body?.amount ?? 0);
  const dueDate = String(body?.dueDate ?? new Date().toISOString().slice(0, 10));
  const issueDate = String(body?.issueDate ?? new Date().toISOString().slice(0, 10));
  const competenceDate = String(body?.competenceDate ?? issueDate);

  if (!description || amount <= 0) {
    return NextResponse.json(
      { error: "Informe descrição e valor maior que zero." },
      { status: 400 }
    );
  }

  const [entry] = await db
    .insert(financialEntries)
    .values({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      type,
      originType: "manual",
      supplierId: body?.supplierId || null,
      customerId: body?.customerId || null,
      categoryId: body?.categoryId || null,
      description,
      competenceDate,
      issueDate,
      dueDate,
      amount: amount.toFixed(2),
      paymentMethodCode: body?.paymentMethodCode || null,
      recurrence: body?.recurrence || "none",
      notes: body?.notes ? String(body.notes) : null,
      createdBy: ctx.user.id,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "financial_entry_created",
    entity: "financial_entry",
    entityId: entry.id,
    newData: { type, description, amount, dueDate },
  });

  return NextResponse.json({ item: entry }, { status: 201 });
}
