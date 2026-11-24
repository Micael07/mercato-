import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, customers, sales, saleItems } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { toNumber } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "customers.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.companyId, ctx.company.id)))
    .limit(1);

  if (!customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const customerSales = await db
    .select()
    .from(sales)
    .where(
      and(
        eq(sales.companyId, ctx.company.id),
        eq(sales.customerId, id),
        eq(sales.status, "completed")
      )
    )
    .orderBy(desc(sales.createdAt))
    .limit(50);

  const totalSpent = customerSales.reduce((acc, s) => acc + toNumber(s.total), 0);
  const averageTicket =
    customerSales.length > 0 ? totalSpent / customerSales.length : 0;

  const saleIds = customerSales.map((s) => s.id);
  const items =
    saleIds.length > 0
      ? await db
          .select()
          .from(saleItems)
          .where(inArray(saleItems.saleId, saleIds))
      : [];

  const prodTotals = new Map<
    string,
    { productName: string; quantity: number; total: number }
  >();
  for (const it of items) {
    const prev = prodTotals.get(it.productId) ?? {
      productName: it.productName,
      quantity: 0,
      total: 0,
    };
    prev.quantity += toNumber(it.quantity);
    prev.total += toNumber(it.total);
    prodTotals.set(it.productId, prev);
  }

  const topProducts = Array.from(prodTotals.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  return NextResponse.json({
    customer: {
      ...customer,
      creditLimit: toNumber(customer.creditLimit),
      openBalance: toNumber(customer.openBalance),
    },
    stats: {
      salesCount: customerSales.length,
      totalSpent,
      averageTicket,
    },
    sales: customerSales.map((s) => ({
      ...s,
      total: toNumber(s.total),
    })),
    topProducts,
  });
}
