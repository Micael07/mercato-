import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, lte, SQL } from "drizzle-orm";
import { db, sales, saleItems, products, categories, customers, users } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { toNumber } from "@/lib/format";
import { addDaysStr, endOfDayUtc, isDateStr, startOfDayUtc, todayInTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Detalhe de uma linha de relatório: as vendas por trás do número.
 * ?kind=product|operator|customer|category&value=...&from=&to=
 */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "reports.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "";
  const value = (searchParams.get("value") ?? "").trim();
  const to = isDateStr(searchParams.get("to")) ? searchParams.get("to")! : todayInTz();
  const from = isDateStr(searchParams.get("from")) ? searchParams.get("from")! : addDaysStr(to, -30);
  if (!value || !["product", "operator", "customer", "category"].includes(kind)) {
    return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  }

  const conditions: SQL[] = [
    eq(sales.companyId, ctx.company.id),
    eq(sales.establishmentId, ctx.establishment.id),
    eq(sales.status, "completed"),
    gte(sales.createdAt, startOfDayUtc(from)),
    lte(sales.createdAt, endOfDayUtc(to)),
  ];
  if (kind === "product") conditions.push(eq(saleItems.sku, value));
  if (kind === "operator") conditions.push(eq(users.name, value));
  if (kind === "category") conditions.push(eq(categories.name, value));
  if (kind === "customer") conditions.push(value === "Consumidor final" ? isNull(sales.customerId) : eq(customers.name, value));

  const rows = await db
    .select({
      saleNumber: sales.saleNumber,
      date: sales.createdAt,
      product: saleItems.productName,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      total: saleItems.total,
      operator: users.name,
      customer: customers.name,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(users, eq(sales.operatorId, users.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(200);

  return NextResponse.json({
    rows: rows.map((r) => ({
      saleNumber: `#${r.saleNumber}`,
      date: r.date,
      product: r.product,
      quantity: toNumber(r.quantity),
      salePrice: toNumber(r.unitPrice),
      total: toNumber(r.total),
      operator: r.operator ?? "Sistema",
      customer: r.customer ?? "Consumidor final",
    })),
  });
}
