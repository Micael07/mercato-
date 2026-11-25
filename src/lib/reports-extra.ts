// Relatórios gerenciais adicionais: fechamento de caixa, curva ABC, sugestão de compra,
// vencimentos e perdas. Mantidos fora do route.ts para ficarem testáveis e legíveis.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, products, productStocks, stockMovements, suppliers, users } from "@/db";
import { roundMoney, toNumber } from "@/lib/format";
import { addDaysStr, dateInTz, todayInTz } from "@/lib/dates";

export const EXTRA_REPORT_TYPES = new Set([
  "cash_closing",
  "abc_curve",
  "purchase_suggestion",
  "expiring_products",
  "stock_losses",
]);

type Row = Record<string, unknown>;
export interface ExtraCtx {
  companyId: string;
  establishmentId: string;
  from: Date;
  to: Date;
  fromStr: string;
  toStr: string;
  canViewCost: boolean;
}

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

/** Classe pelo acumulado ANTES do item: o item que cruza 80% ainda é A, o que cruza 95% ainda é B. */
export function classifyAbc(cumulativeBefore: number): "A" | "B" | "C" {
  return cumulativeBefore < 80 ? "A" : cumulativeBefore < 95 ? "B" : "C";
}

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function expiryStatus(days: number): string {
  if (days < 0) return "Vencido";
  if (days <= 7) return "Vence em até 7 dias";
  if (days <= 30) return "Vence em até 30 dias";
  return "Vence em até 60 dias";
}

/** Sugestão: repor até cobrir 15 dias de venda (ou o máximo cadastrado), quando a cobertura está baixa. */
export function suggestQuantity(p: { stock: number; avgDaily: number; minStock: number; maxStock: number; fractional: boolean }): number {
  const target = Math.max(p.maxStock, p.minStock, p.avgDaily * 15);
  const trigger = Math.max(p.minStock, p.avgDaily * 7);
  if (p.stock > trigger) return 0;
  const need = target - p.stock;
  if (need <= 0) return 0;
  return p.fractional ? Math.round(need * 1000) / 1000 : Math.ceil(need);
}

export async function buildExtraReport(type: string, c: ExtraCtx): Promise<Row[]> {
  switch (type) {
    case "cash_closing": {
      const res = await db.execute(sql`
        select cr.id, cr.terminal_name as terminal, u.name as operator, cr.opened_at as "openedAt",
          cr.closed_at as "closedAt", cr.status, cr.opening_amount as opening,
          cr.expected_closing_amount as expected, cr.counted_closing_amount as counted,
          cr.difference_amount as difference, cr.current_balance as balance,
          coalesce(sum(cm.amount) filter (where cm.type = 'sale_in' and cm.payment_method_code = 'cash'), 0) as "cashSales",
          coalesce(sum(cm.amount) filter (where cm.type = 'sale_in' and coalesce(cm.payment_method_code,'') <> 'cash'), 0) as "otherSales",
          coalesce(sum(abs(cm.amount)) filter (where cm.type = 'supply'), 0) as supply,
          coalesce(sum(abs(cm.amount)) filter (where cm.type = 'bleed'), 0) as bleed
        from cash_registers cr
        left join users u on u.id = cr.user_id
        left join cash_movements cm on cm.cash_register_id = cr.id
        where cr.company_id = ${c.companyId} and cr.establishment_id = ${c.establishmentId}
          and cr.opened_at >= ${c.from.toISOString()} and cr.opened_at <= ${c.to.toISOString()}
        group by cr.id, u.name
        order by cr.opened_at desc`);
      return rowsOf<Record<string, unknown>>(res).map((r) => {
        const closed = r.status === "closed";
        return {
          terminal: r.terminal,
          operator: r.operator ?? "—",
          openedAt: r.openedAt ? new Date(r.openedAt as string).toISOString() : null,
          closedAt: r.closedAt ? new Date(r.closedAt as string).toISOString() : null,
          status: closed ? "Fechado" : "Aberto",
          opening: toNumber(r.opening),
          cashSales: toNumber(r.cashSales),
          otherSales: toNumber(r.otherSales),
          supply: toNumber(r.supply),
          bleed: toNumber(r.bleed),
          expected: closed ? toNumber(r.expected) : toNumber(r.balance),
          counted: closed ? toNumber(r.counted) : null,
          difference: closed ? toNumber(r.difference) : null,
        };
      });
    }

    case "abc_curve": {
      const res = await db.execute(sql`
        select si.product_id as id, max(si.sku) as sku, max(si.product_name) as name,
          sum(si.quantity)::float8 as quantity, sum(si.total)::float8 as revenue
        from sale_items si join sales s on s.id = si.sale_id
        where s.company_id = ${c.companyId} and s.establishment_id = ${c.establishmentId}
          and s.status = 'completed'
          and s.created_at >= ${c.from.toISOString()} and s.created_at <= ${c.to.toISOString()}
        group by si.product_id
        order by revenue desc`);
      const list = rowsOf<{ sku: string; name: string; quantity: number; revenue: number }>(res);
      const total = list.reduce((a, r) => a + Number(r.revenue), 0);
      let acc = 0;
      return list.map((r) => {
        acc += Number(r.revenue);
        const cumulative = total > 0 ? (acc / total) * 100 : 0;
        const before = total > 0 ? ((acc - Number(r.revenue)) / total) * 100 : 0;
        return {
          abcClass: classifyAbc(before),
          sku: r.sku,
          name: r.name,
          quantity: Number(r.quantity),
          revenue: roundMoney(Number(r.revenue)),
          percent: total > 0 ? (Number(r.revenue) / total) * 100 : 0,
          cumulativePercent: cumulative,
        };
      });
    }

    case "purchase_suggestion": {
      const days = Math.max(1, daysBetween(c.fromStr, c.toStr) + 1);
      const sold = await db.execute(sql`
        select si.product_id as id, sum(si.quantity)::float8 as qty
        from sale_items si join sales s on s.id = si.sale_id
        where s.company_id = ${c.companyId} and s.establishment_id = ${c.establishmentId}
          and s.status = 'completed'
          and s.created_at >= ${c.from.toISOString()} and s.created_at <= ${c.to.toISOString()}
        group by si.product_id`);
      const soldMap = new Map(rowsOf<{ id: string; qty: number }>(sold).map((r) => [r.id, Number(r.qty)]));
      const prods = await db
        .select({
          id: products.id, sku: products.sku, name: products.name, unit: products.unit,
          minStock: products.minStock, maxStock: products.maxStock, costPrice: products.costPrice,
          fractional: products.allowFractional, trackStock: products.trackStock,
          supplier: suppliers.tradeName, stock: productStocks.quantity,
        })
        .from(products)
        .leftJoin(suppliers, eq(products.mainSupplierId, suppliers.id))
        .leftJoin(productStocks, and(eq(productStocks.productId, products.id), eq(productStocks.establishmentId, c.establishmentId)))
        .where(and(eq(products.companyId, c.companyId), eq(products.status, "active")));
      const out: Row[] = [];
      for (const p of prods) {
        if (!p.trackStock) continue;
        const stock = toNumber(p.stock ?? 0);
        const avgDaily = (soldMap.get(p.id) ?? 0) / days;
        const qty = suggestQuantity({
          stock, avgDaily, minStock: toNumber(p.minStock), maxStock: toNumber(p.maxStock), fractional: p.fractional,
        });
        if (qty <= 0) continue;
        out.push({
          supplier: p.supplier ?? "Sem fornecedor",
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          quantity: stock,
          avgDaily: Math.round(avgDaily * 100) / 100,
          coverDays: avgDaily > 0 ? Math.round((stock / avgDaily) * 10) / 10 : null,
          minStock: toNumber(p.minStock),
          suggestedQty: qty,
          ...(c.canViewCost ? { estimatedCost: roundMoney(qty * toNumber(p.costPrice)) } : {}),
        });
      }
      return out.sort((a, b) => String(a.supplier).localeCompare(String(b.supplier), "pt-BR") || Number(a.coverDays ?? 9999) - Number(b.coverDays ?? 9999));
    }

    case "expiring_products": {
      const today = todayInTz();
      const limit = addDaysStr(today, 60);
      const rows = await db
        .select({
          sku: products.sku, name: products.name, unit: products.unit, expiry: products.expiryDate,
          costPrice: products.costPrice, salePrice: products.salePrice, stock: productStocks.quantity,
        })
        .from(products)
        .innerJoin(productStocks, and(eq(productStocks.productId, products.id), eq(productStocks.establishmentId, c.establishmentId)))
        .where(and(eq(products.companyId, c.companyId), eq(products.status, "active"), sql`${products.expiryDate} is not null`, sql`${products.expiryDate} <= ${limit}`, sql`${productStocks.quantity} > 0`))
        .orderBy(asc(products.expiryDate));
      return rows.map((r) => {
        const days = daysBetween(today, String(r.expiry));
        const qty = toNumber(r.stock);
        return {
          expiryDate: String(r.expiry),
          daysToExpire: days,
          status: expiryStatus(days),
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          quantity: qty,
          stockSaleValue: roundMoney(qty * toNumber(r.salePrice)),
          ...(c.canViewCost ? { stockCostValue: roundMoney(qty * toNumber(r.costPrice)) } : {}),
        };
      });
    }

    case "stock_losses": {
      const rows = await db
        .select({
          date: stockMovements.createdAt, sku: products.sku, product: products.name, type: stockMovements.type,
          quantity: stockMovements.quantity, unitCost: stockMovements.unitCost,
          user: users.name, justification: stockMovements.justification,
        })
        .from(stockMovements)
        .innerJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(users, eq(stockMovements.userId, users.id))
        .where(and(
          eq(stockMovements.companyId, c.companyId),
          eq(stockMovements.establishmentId, c.establishmentId),
          inArray(stockMovements.type, ["loss_expired", "loss_breakage", "loss_theft"]),
          gte(stockMovements.createdAt, c.from), lte(stockMovements.createdAt, c.to),
        ))
        .orderBy(desc(stockMovements.createdAt));
      return rows.map((r) => ({
        date: r.date, sku: r.sku, product: r.product, type: r.type,
        quantity: toNumber(r.quantity),
        ...(c.canViewCost ? { lossValue: roundMoney(toNumber(r.quantity) * toNumber(r.unitCost)) } : {}),
        user: r.user ?? "—", justification: r.justification ?? "",
      }));
    }
  }
  return [];
}

void dateInTz;
