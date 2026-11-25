// Escolhe, a partir das linhas do relatório, o gráfico mais útil (ou nenhum).
export interface ChartItem { label: string; value: number }
export interface ChartSpec { kind: "time" | "rank"; title: string; valueKey: string; items: ChartItem[] }

const TIME_TYPES = new Set(["sales_period", "purchases_period", "cash_flow"]);
const LABEL_KEYS = ["name", "product", "category", "categoryName", "operator", "customer", "method", "supplier", "terminal", "description"];
const VALUE_KEYS = ["revenue", "total", "amount", "lossValue", "estimatedCost", "stockSaleValue", "quantity", "suggestedQty", "salesCount", "count"];
const NO_CHART = new Set(["income_statement", "inventories", "stock_movements"]);

export function dayLabel(iso: string, tz = "America/Manaus"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz }).format(d);
}

export function chartSpec(
  type: string,
  rows: Array<Record<string, unknown>>,
  columnLabel: (k: string) => string,
  tz = "America/Manaus"
): ChartSpec | null {
  if (rows.length < 2 || NO_CHART.has(type)) return null;
  const keys = Object.keys(rows[0]);
  const valueKey = VALUE_KEYS.find((k) => keys.includes(k) && typeof rows[0][k] === "number");
  if (!valueKey) return null;

  if (TIME_TYPES.has(type) && keys.includes("date")) {
    const by = new Map<string, { label: string; value: number; t: number }>();
    for (const r of rows) {
      const t = new Date(String(r.date)).getTime();
      if (Number.isNaN(t)) continue;
      const label = dayLabel(String(r.date), tz);
      const cur = by.get(label) ?? { label, value: 0, t };
      cur.value += Number(r[valueKey]) || 0;
      cur.t = Math.min(cur.t, t);
      by.set(label, cur);
    }
    const items = [...by.values()].sort((a, b) => a.t - b.t).slice(-31);
    return items.length >= 2 ? { kind: "time", title: `${columnLabel(valueKey)} por dia`, valueKey, items: items.map(({ label, value }) => ({ label, value: Math.round(value * 100) / 100 })) } : null;
  }

  const labelKey = LABEL_KEYS.find((k) => keys.includes(k) && typeof rows[0][k] === "string");
  if (!labelKey) return null;
  const items = rows
    .map((r) => ({ label: String(r[labelKey] ?? ""), value: Number(r[valueKey]) || 0 }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  return items.length >= 2 ? { kind: "rank", title: `${columnLabel(valueKey)} · principais`, valueKey, items } : null;
}

/** Variação percentual; null quando não há base de comparação. */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Período imediatamente anterior, com a mesma duração (AAAA-MM-DD). */
export function previousRange(from: string, to: string): [string, string] {
  const day = 86400000;
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  const len = Math.round((t - f) / day) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [iso(f - len * day), iso(f - day)];
}
