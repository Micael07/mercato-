import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  sales,
  saleItems,
  salePayments,
  products,
  productStocks,
  categories,
  cashRegisters,
  purchaseOrders,
  financialEntries,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { roundMoney, toNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const canFinance = ctx.permissions.has("finance.read");
  const canCost = ctx.permissions.has("products.view_cost");
  const canSales = ctx.permissions.has("sales.read");

  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(searchParams.get("days") ?? 30)));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStart = new Date(now.getTime() - days * 86400 * 1000);
  const prevPeriodStart = new Date(periodStart.getTime() - days * 86400 * 1000);

  // Sales in period + previous period
  const completedSales = canSales
    ? await db
        .select({
          id: sales.id,
          total: sales.total,
          operatorId: sales.operatorId,
          operatorName: users.name,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .leftJoin(users, eq(sales.operatorId, users.id))
        .where(
          and(
            eq(sales.companyId, ctx.company.id),
            eq(sales.establishmentId, ctx.establishment.id),
            eq(sales.status, "completed"),
            gte(sales.createdAt, prevPeriodStart)
          )
        )
        .orderBy(desc(sales.createdAt))
    : [];

  const currentSales = completedSales.filter((s) => s.createdAt >= periodStart);
  const prevSales = completedSales.filter(
    (s) => s.createdAt >= prevPeriodStart && s.createdAt < periodStart
  );
  const todaySales = completedSales.filter((s) => s.createdAt >= startOfDay);
  const monthSales = completedSales.filter((s) => s.createdAt >= startOfMonth);

  const salesTodayTotal = roundMoney(
    todaySales.reduce((a, s) => a + toNumber(s.total), 0)
  );
  const salesMonthTotal = roundMoney(
    monthSales.reduce((a, s) => a + toNumber(s.total), 0)
  );
  const periodTotal = roundMoney(
    currentSales.reduce((a, s) => a + toNumber(s.total), 0)
  );
  const prevPeriodTotal = roundMoney(
    prevSales.reduce((a, s) => a + toNumber(s.total), 0)
  );
  const avgTicket =
    currentSales.length > 0 ? roundMoney(periodTotal / currentSales.length) : 0;

  // Sale items & payments for current period
  const currentIds = currentSales.map((s) => s.id);
  const itemsRows =
    currentIds.length > 0
      ? await db
          .select({
            productId: saleItems.productId,
            productName: saleItems.productName,
            quantity: saleItems.quantity,
            total: saleItems.total,
            categoryName: categories.name,
          })
          .from(saleItems)
          .leftJoin(products, eq(saleItems.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(inArray(saleItems.saleId, currentIds))
      : [];

  const paysRows =
    currentIds.length > 0
      ? await db
          .select()
          .from(salePayments)
          .where(inArray(salePayments.saleId, currentIds))
      : [];

  const productsSoldCount = roundMoney(
    itemsRows.reduce((a, i) => a + toNumber(i.quantity), 0)
  );

  // Sales by day chart
  const byDayMap = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400 * 1000);
    byDayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const s of currentSales) {
    const key = s.createdAt.toISOString().slice(0, 10);
    if (byDayMap.has(key)) {
      byDayMap.set(key, roundMoney((byDayMap.get(key) ?? 0) + toNumber(s.total)));
    }
  }
  const salesByDay = Array.from(byDayMap.entries()).map(([date, total]) => ({
    date,
    total,
  }));

  // Sales by payment method
  const byPaymentMap = new Map<string, number>();
  for (const p of paysRows) {
    byPaymentMap.set(
      p.paymentMethodName,
      roundMoney((byPaymentMap.get(p.paymentMethodName) ?? 0) + toNumber(p.amount))
    );
  }
  const salesByPayment = Array.from(byPaymentMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  // Top products
  const topProdMap = new Map<string, { name: string; quantity: number; total: number }>();
  for (const i of itemsRows) {
    const prev = topProdMap.get(i.productId) ?? {
      name: i.productName,
      quantity: 0,
      total: 0,
    };
    prev.quantity += toNumber(i.quantity);
    prev.total = roundMoney(prev.total + toNumber(i.total));
    topProdMap.set(i.productId, prev);
  }
  const topProducts = Array.from(topProdMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  // Top categories
  const topCatMap = new Map<string, number>();
  for (const i of itemsRows) {
    const c = i.categoryName || "Sem categoria";
    topCatMap.set(c, roundMoney((topCatMap.get(c) ?? 0) + toNumber(i.total)));
  }
  const topCategories = Array.from(topCatMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  // Operator performance
  const opMap = new Map<string, { name: string; count: number; total: number }>();
  for (const s of currentSales) {
    const key = s.operatorName || "Sistema";
    const prev = opMap.get(key) ?? { name: key, count: 0, total: 0 };
    prev.count += 1;
    prev.total = roundMoney(prev.total + toNumber(s.total));
    opMap.set(key, prev);
  }
  const operatorPerformance = Array.from(opMap.values()).sort(
    (a, b) => b.total - a.total
  );

  // Stock alerts
  const stockRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      minStock: products.minStock,
      trackStock: products.trackStock,
      quantity: productStocks.quantity,
    })
    .from(products)
    .leftJoin(
      productStocks,
      and(
        eq(productStocks.productId, products.id),
        eq(productStocks.establishmentId, ctx.establishment.id)
      )
    )
    .where(and(eq(products.companyId, ctx.company.id), eq(products.status, "active")));

  const lowStockItems = stockRows
    .filter((p) => {
      if (!p.trackStock) return false;
      const q = toNumber(p.quantity ?? 0);
      return q > 0 && q <= toNumber(p.minStock);
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      quantity: toNumber(p.quantity ?? 0),
      minStock: toNumber(p.minStock),
    }));

  const zeroStockItems = stockRows
    .filter((p) => p.trackStock && toNumber(p.quantity ?? 0) <= 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      quantity: toNumber(p.quantity ?? 0),
      minStock: toNumber(p.minStock),
    }));

  // Open cash register balance
  const openCash = await db
    .select()
    .from(cashRegisters)
    .where(
      and(
        eq(cashRegisters.companyId, ctx.company.id),
        eq(cashRegisters.establishmentId, ctx.establishment.id),
        eq(cashRegisters.status, "open")
      )
    );
  const cashBalance = roundMoney(
    openCash.reduce((a, r) => a + toNumber(r.currentBalance), 0)
  );

  // Pending purchase orders
  const pendingPurchases = await db
    .select({ id: purchaseOrders.id, total: purchaseOrders.total })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, ctx.company.id),
        eq(purchaseOrders.establishmentId, ctx.establishment.id),
        inArray(purchaseOrders.status, [
          "draft",
          "pending_approval",
          "approved",
          "sent",
          "partially_received",
        ])
      )
    );

  // Financial (only if finance.read)
  let accountsReceivable = null;
  let accountsPayable = null;
  let expensesPeriod = null;

  if (canFinance) {
    const entries = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.companyId, ctx.company.id),
          eq(financialEntries.establishmentId, ctx.establishment.id)
        )
      );

    accountsReceivable = roundMoney(
      entries
        .filter(
          (e) =>
            e.type === "receivable" &&
            (e.status === "open" || e.status === "partial")
        )
        .reduce((a, e) => a + (toNumber(e.amount) - toNumber(e.paidAmount)), 0)
    );

    accountsPayable = roundMoney(
      entries
        .filter(
          (e) =>
            e.type === "payable" &&
            (e.status === "open" || e.status === "partial")
        )
        .reduce((a, e) => a + (toNumber(e.amount) - toNumber(e.paidAmount)), 0)
    );

    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const nowStr = now.toISOString().slice(0, 10);
    expensesPeriod = roundMoney(
      entries
        .filter(
          (e) =>
            e.type === "payable" &&
            e.status !== "cancelled" &&
            e.dueDate >= periodStartStr &&
            e.dueDate <= nowStr
        )
        .reduce((a, e) => a + toNumber(e.amount), 0)
    );
  }

  return NextResponse.json({
    permissions: { canFinance, canCost, canSales },
    kpis: {
      salesTodayTotal,
      salesMonthTotal,
      periodTotal,
      prevPeriodTotal,
      avgTicket,
      salesCount: currentSales.length,
      productsSoldCount,
      cashBalance,
      openRegistersCount: openCash.length,
      lowStockCount: lowStockItems.length,
      zeroStockCount: zeroStockItems.length,
      pendingPurchasesCount: pendingPurchases.length,
      accountsReceivable,
      accountsPayable,
      expensesPeriod,
    },
    charts: {
      salesByDay,
      salesByPayment,
      topProducts,
      topCategories,
      operatorPerformance,
    },
    alerts: {
      lowStockItems: lowStockItems.slice(0, 8),
      zeroStockItems: zeroStockItems.slice(0, 8),
    },
  });
}
