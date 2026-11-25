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
  customers,
  suppliers,
  stockMovements,
  inventories,
  purchaseOrders,
  financialEntries,
  financialCategories,
  establishments,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { roundMoney, toNumber } from "@/lib/format";
import { addDaysStr, endOfDayUtc, isDateStr, startOfDayUtc, todayInTz } from "@/lib/dates";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "reports.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const canViewCost = ctx.permissions.has("products.view_cost");
  const canFinance = ctx.permissions.has("finance.read");

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "sales_period";
  const today = todayInTz();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const from = isDateStr(fromParam) ? fromParam : addDaysStr(today, -30);
  const to = isDateStr(toParam) ? toParam : today;

  // Limites do período no fuso da loja (o servidor roda em UTC).
  const fromDate = startOfDayUtc(from);
  const toDate = endOfDayUtc(to);

  if (
    ["payables", "receivables", "cash_flow", "expenses_category"].includes(type) &&
    !canFinance
  ) {
    return NextResponse.json(
      { error: "Sem permissão para relatórios financeiros." },
      { status: 403 }
    );
  }

  if (type === "income_statement" && !(canFinance && canViewCost)) {
    return NextResponse.json(
      { error: "O resultado do período exige permissão financeira e de custos." },
      { status: 403 }
    );
  }

  if (type === "gross_margin" && !canViewCost) {
    return NextResponse.json(
      { error: "Sem permissão para visualizar custos e margem." },
      { status: 403 }
    );
  }

  const companySales = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      establishmentId: sales.establishmentId,
      customerId: sales.customerId,
      customerName: customers.name,
      operatorName: users.name,
      subtotal: sales.subtotal,
      discountTotal: sales.discountTotal,
      total: sales.total,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.operatorId, users.id))
    .where(
      and(
        eq(sales.companyId, ctx.company.id),
        eq(sales.status, "completed"),
        gte(sales.createdAt, fromDate),
        lte(sales.createdAt, toDate)
      )
    )
    .orderBy(desc(sales.createdAt));

  const estSales = companySales.filter(
    (s) => s.establishmentId === ctx.establishment.id
  );
  const estSaleIds = estSales.map((s) => s.id);

  switch (type) {
    case "sales_period":
      return NextResponse.json({
        columns: ["Nº Venda", "Data", "Cliente", "Operador", "Subtotal", "Desconto", "Total"],
        rows: estSales.map((s) => ({
          saleNumber: `#${s.saleNumber}`,
          date: s.createdAt,
          customer: s.customerName || "Consumidor final",
          operator: s.operatorName || "Sistema",
          subtotal: toNumber(s.subtotal),
          discount: toNumber(s.discountTotal),
          total: toNumber(s.total),
        })),
      });

    case "sales_product":
    case "top_products":
    case "gross_margin": {
      const items =
        estSaleIds.length > 0
          ? await db
              .select({
                productId: saleItems.productId,
                productName: saleItems.productName,
                sku: saleItems.sku,
                quantity: saleItems.quantity,
                total: saleItems.total,
                cost: saleItems.costPriceSnapshot,
              })
              .from(saleItems)
              .where(inArray(saleItems.saleId, estSaleIds))
          : [];
      const map = new Map<
        string,
        { sku: string; name: string; qty: number; revenue: number; cost: number }
      >();
      for (const it of items) {
        const prev = map.get(it.productId) ?? {
          sku: it.sku,
          name: it.productName,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
        const q = toNumber(it.quantity);
        prev.qty += q;
        prev.revenue = roundMoney(prev.revenue + toNumber(it.total));
        prev.cost = roundMoney(prev.cost + toNumber(it.cost) * q);
        map.set(it.productId, prev);
      }
      const list = Array.from(map.values()).sort((a, b) =>
        type === "top_products" ? b.qty - a.qty : b.revenue - a.revenue
      );
      return NextResponse.json({
        rows: list.map((r) => ({
          sku: r.sku,
          name: r.name,
          quantity: r.qty,
          revenue: r.revenue,
          ...(canViewCost
            ? {
                cost: r.cost,
                grossProfit: roundMoney(r.revenue - r.cost),
                marginPercent:
                  r.revenue > 0
                    ? roundMoney(((r.revenue - r.cost) / r.revenue) * 100)
                    : 0,
              }
            : {}),
        })),
      });
    }

    case "sales_category": {
      const items =
        estSaleIds.length > 0
          ? await db
              .select({
                categoryName: categories.name,
                quantity: saleItems.quantity,
                total: saleItems.total,
              })
              .from(saleItems)
              .leftJoin(products, eq(saleItems.productId, products.id))
              .leftJoin(categories, eq(products.categoryId, categories.id))
              .where(inArray(saleItems.saleId, estSaleIds))
          : [];
      const map = new Map<string, { category: string; qty: number; total: number }>();
      for (const it of items) {
        const c = it.categoryName || "Sem categoria";
        const prev = map.get(c) ?? { category: c, qty: 0, total: 0 };
        prev.qty += toNumber(it.quantity);
        prev.total = roundMoney(prev.total + toNumber(it.total));
        map.set(c, prev);
      }
      return NextResponse.json({
        rows: Array.from(map.values()).sort((a, b) => b.total - a.total),
      });
    }

    case "sales_operator": {
      const map = new Map<string, { operator: string; count: number; total: number }>();
      for (const s of estSales) {
        const op = s.operatorName || "Sistema";
        const prev = map.get(op) ?? { operator: op, count: 0, total: 0 };
        prev.count += 1;
        prev.total = roundMoney(prev.total + toNumber(s.total));
        map.set(op, prev);
      }
      return NextResponse.json({
        rows: Array.from(map.values()).map((r) => ({
          ...r,
          avgTicket: r.count > 0 ? roundMoney(r.total / r.count) : 0,
        })),
      });
    }

    case "sales_customer": {
      const map = new Map<string, { customer: string; count: number; total: number }>();
      for (const s of estSales) {
        const c = s.customerName || "Consumidor final";
        const prev = map.get(c) ?? { customer: c, count: 0, total: 0 };
        prev.count += 1;
        prev.total = roundMoney(prev.total + toNumber(s.total));
        map.set(c, prev);
      }
      return NextResponse.json({
        rows: Array.from(map.values()).sort((a, b) => b.total - a.total),
      });
    }

    case "sales_payment": {
      const pays =
        estSaleIds.length > 0
          ? await db
              .select()
              .from(salePayments)
              .where(inArray(salePayments.saleId, estSaleIds))
          : [];
      const map = new Map<string, { method: string; count: number; total: number }>();
      for (const p of pays) {
        const prev = map.get(p.paymentMethodName) ?? {
          method: p.paymentMethodName,
          count: 0,
          total: 0,
        };
        prev.count += 1;
        prev.total = roundMoney(prev.total + toNumber(p.amount));
        map.set(p.paymentMethodName, prev);
      }
      return NextResponse.json({
        rows: Array.from(map.values()).sort((a, b) => b.total - a.total),
      });
    }

    case "current_stock":
    case "low_stock":
    case "stagnant_products": {
      const allProds = await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          unit: products.unit,
          minStock: products.minStock,
          salePrice: products.salePrice,
          costPrice: products.costPrice,
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

      let filtered = allProds;
      if (type === "low_stock") {
        filtered = allProds.filter(
          (p) => toNumber(p.quantity ?? 0) <= toNumber(p.minStock)
        );
      } else if (type === "stagnant_products") {
        const soldIds = new Set(
          estSaleIds.length > 0
            ? (
                await db
                  .select({ productId: saleItems.productId })
                  .from(saleItems)
                  .where(inArray(saleItems.saleId, estSaleIds))
              ).map((i) => i.productId)
            : []
        );
        filtered = allProds.filter((p) => !soldIds.has(p.id));
      }

      return NextResponse.json({
        rows: filtered.map((p) => {
          const qty = toNumber(p.quantity ?? 0);
          return {
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            quantity: qty,
            minStock: toNumber(p.minStock),
            salePrice: toNumber(p.salePrice),
            stockSaleValue: roundMoney(qty * toNumber(p.salePrice)),
            ...(canViewCost
              ? {
                  costPrice: toNumber(p.costPrice),
                  stockCostValue: roundMoney(qty * toNumber(p.costPrice)),
                }
              : {}),
          };
        }),
      });
    }

    case "stock_movements": {
      const movs = await db
        .select({
          date: stockMovements.createdAt,
          sku: products.sku,
          product: products.name,
          type: stockMovements.type,
          quantity: stockMovements.quantity,
          previousBalance: stockMovements.previousBalance,
          newBalance: stockMovements.newBalance,
          originDocument: stockMovements.originDocument,
          user: users.name,
        })
        .from(stockMovements)
        .innerJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(users, eq(stockMovements.userId, users.id))
        .where(
          and(
            eq(stockMovements.companyId, ctx.company.id),
            eq(stockMovements.establishmentId, ctx.establishment.id),
            gte(stockMovements.createdAt, fromDate),
            lte(stockMovements.createdAt, toDate)
          )
        )
        .orderBy(desc(stockMovements.createdAt));

      return NextResponse.json({
        rows: movs.map((m) => ({
          ...m,
          quantity: toNumber(m.quantity),
          previousBalance: toNumber(m.previousBalance),
          newBalance: toNumber(m.newBalance),
        })),
      });
    }

    case "inventories": {
      const invs = await db
        .select()
        .from(inventories)
        .where(
          and(
            eq(inventories.companyId, ctx.company.id),
            eq(inventories.establishmentId, ctx.establishment.id)
          )
        )
        .orderBy(desc(inventories.openedAt));
      return NextResponse.json({
        rows: invs.map((i) => ({
          code: i.code,
          description: i.description,
          status: i.status,
          openedAt: i.openedAt,
          closedAt: i.closedAt,
        })),
      });
    }

    case "purchases_supplier":
    case "purchases_period": {
      const pos = await db
        .select({
          orderNumber: purchaseOrders.orderNumber,
          supplier: suppliers.tradeName,
          status: purchaseOrders.status,
          total: purchaseOrders.total,
          createdAt: purchaseOrders.createdAt,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(
          and(
            eq(purchaseOrders.companyId, ctx.company.id),
            eq(purchaseOrders.establishmentId, ctx.establishment.id),
            gte(purchaseOrders.createdAt, fromDate),
            lte(purchaseOrders.createdAt, toDate)
          )
        )
        .orderBy(desc(purchaseOrders.createdAt));

      if (type === "purchases_supplier") {
        const map = new Map<string, { supplier: string; count: number; total: number }>();
        for (const p of pos) {
          const s = p.supplier || "Fornecedor";
          const prev = map.get(s) ?? { supplier: s, count: 0, total: 0 };
          prev.count += 1;
          prev.total = roundMoney(prev.total + toNumber(p.total));
          map.set(s, prev);
        }
        return NextResponse.json({ rows: Array.from(map.values()) });
      }
      return NextResponse.json({
        rows: pos.map((p) => ({
          orderNumber: `#${p.orderNumber}`,
          supplier: p.supplier,
          status: p.status,
          total: toNumber(p.total),
          date: p.createdAt,
        })),
      });
    }

    case "payables":
    case "receivables":
    case "cash_flow":
    case "expenses_category": {
      const entries = await db
        .select({
          type: financialEntries.type,
          description: financialEntries.description,
          dueDate: financialEntries.dueDate,
          amount: financialEntries.amount,
          paidAmount: financialEntries.paidAmount,
          status: financialEntries.status,
          categoryName: financialCategories.name,
        })
        .from(financialEntries)
        .leftJoin(
          financialCategories,
          eq(financialEntries.categoryId, financialCategories.id)
        )
        .where(
          and(
            eq(financialEntries.companyId, ctx.company.id),
            eq(financialEntries.establishmentId, ctx.establishment.id),
            gte(financialEntries.dueDate, from),
            lte(financialEntries.dueDate, to)
          )
        );

      if (type === "expenses_category") {
        const map = new Map<string, { category: string; total: number; paid: number }>();
        for (const e of entries.filter((x) => x.type === "payable" && x.status !== "cancelled")) {
          const c = e.categoryName || "Sem categoria";
          const prev = map.get(c) ?? { category: c, total: 0, paid: 0 };
          prev.total = roundMoney(prev.total + toNumber(e.amount));
          prev.paid = roundMoney(prev.paid + toNumber(e.paidAmount));
          map.set(c, prev);
        }
        return NextResponse.json({ rows: Array.from(map.values()) });
      }

      const filtered =
        type === "payables"
          ? entries.filter((e) => e.type === "payable")
          : type === "receivables"
          ? entries.filter((e) => e.type === "receivable")
          : entries;

      return NextResponse.json({
        rows: filtered.map((e) => ({
          ...e,
          amount: toNumber(e.amount),
          paidAmount: toNumber(e.paidAmount),
        })),
      });
    }

    case "income_statement": {
      const saleRows = estSales;
      const gross = roundMoney(saleRows.reduce((a, s) => a + toNumber(s.subtotal), 0));
      const discounts = roundMoney(saleRows.reduce((a, s) => a + toNumber(s.discountTotal), 0));
      const net = roundMoney(saleRows.reduce((a, s) => a + toNumber(s.total), 0));

      const itemRows =
        estSaleIds.length > 0
          ? await db
              .select({ quantity: saleItems.quantity, cost: saleItems.costPriceSnapshot })
              .from(saleItems)
              .where(inArray(saleItems.saleId, estSaleIds))
          : [];
      const cmv = roundMoney(
        itemRows.reduce((a, i) => a + toNumber(i.quantity) * toNumber(i.cost), 0)
      );
      const grossProfit = roundMoney(net - cmv);

      // Despesas: contas a pagar do período, sem as geradas por compra de mercadoria
      // (a mercadoria já entra como custo da venda).
      const expenseRows = await db
        .select({
          amount: financialEntries.amount,
          category: financialCategories.name,
          origin: financialEntries.originType,
          status: financialEntries.status,
        })
        .from(financialEntries)
        .leftJoin(financialCategories, eq(financialEntries.categoryId, financialCategories.id))
        .where(
          and(
            eq(financialEntries.companyId, ctx.company.id),
            eq(financialEntries.establishmentId, ctx.establishment.id),
            eq(financialEntries.type, "payable"),
            gte(financialEntries.dueDate, from),
            lte(financialEntries.dueDate, to)
          )
        );
      const byCat = new Map<string, number>();
      for (const e of expenseRows) {
        if (e.origin === "purchase" || e.status === "cancelled") continue;
        const c = e.category || "Sem categoria";
        byCat.set(c, roundMoney((byCat.get(c) ?? 0) + toNumber(e.amount)));
      }
      const cats = Array.from(byCat.entries())
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      const expenses = roundMoney(cats.reduce((a, [, v]) => a + v, 0));
      const result = roundMoney(grossProfit - expenses);

      const pct = (v: number) => (net > 0 ? roundMoney((v / net) * 100) : 0);
      const line = (description: string, amount: number, bold = false, indent = false) => ({
        description: indent ? `   ${description}` : description,
        amount,
        percent: pct(amount),
        _bold: bold,
      });
      return NextResponse.json({
        rows: [
          line("Receita bruta de vendas", gross),
          line("(–) Descontos concedidos", -discounts),
          line("Receita líquida", net, true),
          line("(–) Custo das mercadorias vendidas", -cmv),
          line("Lucro bruto", grossProfit, true),
          ...cats.map(([c, v]) => line(c, -v, false, true)),
          line("(–) Despesas do período", -expenses),
          line("Resultado do período", result, true),
        ],
      });
    }

    case "establishment_performance": {
      const ests = await db
        .select()
        .from(establishments)
        .where(eq(establishments.companyId, ctx.company.id));
      const rows = ests.map((est) => {
        const es = companySales.filter((s) => s.establishmentId === est.id);
        const total = roundMoney(es.reduce((a, s) => a + toNumber(s.total), 0));
        return {
          code: est.code,
          name: est.name,
          salesCount: es.length,
          total,
          avgTicket: es.length > 0 ? roundMoney(total / es.length) : 0,
        };
      });
      return NextResponse.json({ rows });
    }

    default:
      return NextResponse.json({ rows: [] });
  }
}
