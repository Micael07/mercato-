"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, FileText, Printer, Receipt, Star, X } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { downloadCsv, downloadExcelXml, formatCnpjCpf } from "@/lib/format";
import {
  columnKind,
  columnLabel,
  computeTotals,
  formatCell,
  translateValue,
  visibleKeys,
} from "@/lib/report-format";
import { Button, Input, Modal, Select } from "@/components/ui/primitives";
import { ReportChart } from "@/components/report-chart";
import { ReportThermal } from "@/components/report-thermal";
import { downloadReportPdf, isLandscape } from "@/lib/report-pdf";
import { chartSpec, deltaPercent, previousRange } from "@/lib/report-chart";
import { useToast } from "@/components/ui/toast";

const REPORT_GROUPS = [
  {
    label: "Vendas",
    items: [
      { value: "sales_period", label: "Vendas por período" },
      { value: "sales_product", label: "Vendas por produto" },
      { value: "sales_category", label: "Vendas por categoria" },
      { value: "sales_operator", label: "Vendas por operador / Ticket médio" },
      { value: "sales_customer", label: "Vendas por cliente" },
      { value: "sales_payment", label: "Vendas por forma de pagamento" },
      { value: "top_products", label: "Produtos mais vendidos" },
      { value: "stagnant_products", label: "Produtos sem giro no período" },
      { value: "gross_margin", label: "Margem bruta estimada" },
      { value: "abc_curve", label: "Curva ABC de produtos" },
      { value: "cash_closing", label: "Fechamento de caixa por turno e operador" },
    ],
  },
  {
    label: "Estoque",
    items: [
      { value: "current_stock", label: "Posição de estoque atual" },
      { value: "low_stock", label: "Produtos abaixo do estoque mínimo" },
      { value: "stock_movements", label: "Movimentação de estoque" },
      { value: "inventories", label: "Histórico de inventários" },
      { value: "expiring_products", label: "Produtos vencidos e a vencer (60 dias)" },
      { value: "stock_losses", label: "Perdas de estoque (vencimento, quebra, extravio)" },
    ],
  },
  {
    label: "Compras",
    items: [
      { value: "purchases_supplier", label: "Compras por fornecedor" },
      { value: "purchases_period", label: "Compras por período" },
      { value: "purchase_suggestion", label: "Sugestão de compra (pelo giro do período)" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { value: "income_statement", label: "Resultado do período (DRE simplificado)" },
      { value: "payables", label: "Contas a pagar" },
      { value: "receivables", label: "Contas a receber" },
      { value: "cash_flow", label: "Fluxo de caixa detalhado" },
      { value: "expenses_category", label: "Despesas por categoria" },
    ],
  },
  {
    label: "Gestão",
    items: [{ value: "establishment_performance", label: "Desempenho por estabelecimento" }],
  },
];
const ALL_REPORTS = REPORT_GROUPS.flatMap((g) => g.items);

// Estoque e inventário não dependem do período.
const NO_PERIOD = new Set(["current_stock", "low_stock", "inventories", "expiring_products"]);

const isoLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const PERIODS = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Este mês" },
  { id: "prev", label: "Mês anterior" },
] as const;

function periodRange(id: (typeof PERIODS)[number]["id"]): [string, string] {
  const now = new Date();
  const today = isoLocal(now);
  if (id === "today") return [today, today];
  if (id === "7d") return [isoLocal(addDays(now, -6)), today];
  if (id === "30d") return [isoLocal(addDays(now, -29)), today];
  if (id === "month") return [isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)), today];
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return [isoLocal(first), isoLocal(last)];
}

// Linhas clicáveis: de qual coluna vem o valor e que tipo de detalhe buscar.
const DRILL: Record<string, { kind: string; key: string }> = {
  sales_product: { kind: "product", key: "sku" },
  top_products: { kind: "product", key: "sku" },
  gross_margin: { kind: "product", key: "sku" },
  abc_curve: { kind: "product", key: "sku" },
  sales_operator: { kind: "operator", key: "operator" },
  sales_customer: { kind: "customer", key: "customer" },
  sales_category: { kind: "category", key: "category" },
};
// Relatórios que terminam com linhas de assinatura (conferência).
const SIGN = new Set(["inventories", "cash_closing", "expiring_products", "stock_losses", "current_stock"]);
interface SavedReport { id: string; name: string; reportType: string; period: string }

const brDate = (iso: string) => iso.split("-").reverse().join("/");

function initialType(): string {
  if (typeof window === "undefined") return "sales_period";
  const t = new URLSearchParams(window.location.search).get("type");
  return ALL_REPORTS.some((r) => r.value === t) ? (t as string) : "sales_period";
}

export default function RelatoriosPage() {
  const { session, hasPermission } = useSession();

  const [reportType, setReportType] = useState(initialType);
  const [from, setFrom] = useState(() => periodRange("30d")[0]);
  const [to, setTo] = useState(() => periodRange("30d")[1]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [emittedAt, setEmittedAt] = useState("");
  const { toast } = useToast();
  const [periodId, setPeriodId] = useState<string>("30d");
  const [compare, setCompare] = useState(false);
  const [prevRows, setPrevRows] = useState<Array<Record<string, unknown>>>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [thermalOpen, setThermalOpen] = useState(false);
  const [drill, setDrill] = useState<{ title: string; rows: Array<Record<string, unknown>> | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ type: reportType, from, to });
      const res = await fetch(`/api/reports?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao gerar relatório.");
        setRows([]);
        return;
      }
      setRows(data.rows ?? []);
      setSort(null);
      if (compare && !NO_PERIOD.has(reportType)) {
        const [pf, pt] = previousRange(from, to);
        const pr = await fetch(`/api/reports?${new URLSearchParams({ type: reportType, from: pf, to: pt }).toString()}`);
        setPrevRows(pr.ok ? ((await pr.json()).rows ?? []) : []);
      } else {
        setPrevRows([]);
      }
    } finally {
      setLoading(false);
    }
  }, [reportType, from, to, compare]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/saved", { cache: "no-store" });
      if (res.ok) setSaved((await res.json()).saved ?? []);
    } catch { /* favoritos são opcionais */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadSaved(), 0);
    return () => clearTimeout(t);
  }, [loadSaved]);

  async function saveFavorite() {
    const base = ALL_REPORTS.find((r) => r.value === reportType)?.label ?? "Relatório";
    const name = window.prompt("Nome do favorito:", base.slice(0, 60));
    if (!name) return;
    const res = await fetch("/api/reports/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, reportType, period: periodId === "custom" ? "30d" : periodId }),
    });
    const data = await res.json();
    if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível salvar." }); return; }
    toast({ type: "success", title: "Favorito salvo", description: periodId === "custom" ? "Período personalizado salvo como 30 dias." : undefined });
    void loadSaved();
  }
  async function removeFavorite(id: string) {
    await fetch(`/api/reports/saved?id=${id}`, { method: "DELETE" });
    void loadSaved();
  }
  function openFavorite(f: SavedReport) {
    setReportType(f.reportType);
    applyPeriod((PERIODS.some((p) => p.id === f.period) ? f.period : "30d") as (typeof PERIODS)[number]["id"]);
  }

  async function openDrill(row: Record<string, unknown>) {
    const spec = DRILL[reportType];
    if (!spec || !row[spec.key]) return;
    const value = String(row[spec.key]);
    const title = `${label}: ${String(row.name ?? row.product ?? row.operator ?? row.customer ?? row.category ?? value)}`;
    setDrill({ title, rows: null });
    const qs = new URLSearchParams({ kind: spec.kind, value, from, to });
    const res = await fetch(`/api/reports/drill?${qs.toString()}`);
    const data = res.ok ? await res.json() : { rows: [] };
    setDrill({ title, rows: data.rows ?? [] });
  }

  const keys = useMemo(() => visibleKeys(rows), [rows]);
  const isStatement = reportType === "income_statement";
  const totals = useMemo(() => (isStatement ? {} : computeTotals(keys, rows)), [keys, rows, isStatement]);
  const totalKeys = keys.filter((k) => k in totals);
  const showTotals = totalKeys.length > 0 && rows.length > 1;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "pt-BR", { numeric: true }) * dir;
    });
  }, [rows, sort]);

  const label = ALL_REPORTS.find((r) => r.value === reportType)?.label ?? "Relatório";
  const usesPeriod = !NO_PERIOD.has(reportType);
  const periodText = usesPeriod ? `${brDate(from)} a ${brDate(to)}` : "posição atual";

  const cards = useMemo(() => {
    if (rows.length === 0) return [];
    if (isStatement) {
      const find = (text: string) => rows.find((r) => String(r.description).trim().startsWith(text));
      return [
        { label: "Receita líquida", value: formatCell("amount", find("Receita líquida")?.amount) },
        { label: "Lucro bruto", value: formatCell("amount", find("Lucro bruto")?.amount) },
        { label: "Resultado do período", value: formatCell("amount", find("Resultado do período")?.amount), strong: true },
      ];
    }
    const prevTotals = prevRows.length > 0 ? computeTotals(keys, prevRows) : {};
    const fmtDelta = (cur: number, prev: number | undefined) => {
      if (!compare) return undefined;
      if (prev === undefined) return "sem dados no período anterior";
      const d = deltaPercent(cur, prev);
      return d === null ? "sem base de comparação" : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1).replace(".", ",")}% vs. período anterior`;
    };
    const out: Array<{ label: string; value: string; strong?: boolean; delta?: string; down?: boolean }> = [
      { label: "Registros", value: String(rows.length), delta: fmtDelta(rows.length, prevRows.length > 0 ? prevRows.length : undefined) },
    ];
    for (const k of totalKeys.slice(0, 3)) {
      const d = prevTotals[k] !== undefined ? deltaPercent(totals[k], prevTotals[k]) : null;
      out.push({ label: `Total · ${columnLabel(k)}`, value: formatCell(k, totals[k]), delta: fmtDelta(totals[k], prevTotals[k]), down: d !== null && d < 0 });
    }
    return out;
  }, [rows, prevRows, compare, keys, isStatement, totalKeys, totals]);

  const chart = useMemo(() => chartSpec(reportType, rows, columnLabel), [reportType, rows]);

  const canExport = hasPermission("reports.export");
  const align = (k: string) => (["money", "number", "percent"].includes(columnKind(k)) ? "text-right" : "text-left");

  const exportRows = () =>
    sorted.map((r) => keys.map((k) => (columnKind(k) === "text" ? translateValue(r[k]).trim() : formatCell(k, r[k]))));
  const exportHeader = () => keys.map(columnLabel);
  const exportTotalRow = () =>
    showTotals ? [keys.map((k, i) => (i === 0 ? "TOTAL" : k in totals ? formatCell(k, totals[k]) : ""))] : [];

  const applyPeriod = (id: (typeof PERIODS)[number]["id"]) => {
    const [f, t] = periodRange(id);
    setFrom(f);
    setTo(t);
    setPeriodId(id);
  };

  const doPrint = () => {
    setEmittedAt(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
    setTimeout(() => window.print(), 50);
  };

  const stamp = () => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Manaus" }).format(new Date());

  const doPdf = async () => {
    await downloadReportPdf(`relatorio-${reportType}-${to}`, {
      company: session?.company.tradeName ?? "",
      cnpj: formatCnpjCpf(session?.company.cnpj),
      establishment: session?.establishment.name ?? "",
      title: label,
      periodText,
      emittedAt: stamp(),
      emittedBy: session?.user.name ?? "",
      header: exportHeader(),
      rows: exportRows(),
      totalRow: exportTotalRow()[0],
      rightAligned: keys.map((k) => ["money", "number", "percent"].includes(columnKind(k))),
      signature: SIGN.has(reportType),
    });
  };

  const openThermal = () => {
    setEmittedAt(stamp());
    setThermalOpen(true);
  };

  return (
    <div className={`space-y-4 ${isLandscape(keys.length) ? "report-wide" : ""}`}>
      <div className="print-footer print-only">{session?.company.tradeName} · {label} · emitido em {emittedAt}</div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Relatórios</h1>
          <p className="text-xs text-slate-500">
            Consultas gerenciais em tempo real com exportação CSV, Excel e impressão
          </p>
        </div>

        {canExport && rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => downloadCsv(`relatorio-${reportType}`, exportHeader(), [...exportRows(), ...exportTotalRow()])}
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadExcelXml(
                  `relatorio-${reportType}`,
                  label.slice(0, 28),
                  exportHeader(),
                  sorted.map((r) =>
                    keys.map((k) =>
                      typeof r[k] === "number" && columnKind(k) !== "text"
                        ? (r[k] as number)
                        : columnKind(k) === "text"
                          ? translateValue(r[k]).trim()
                          : formatCell(k, r[k])
                    )
                  )
                )
              }
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button variant="outline" onClick={() => void doPdf()}>
              <FileText className="h-4 w-4" />
              Baixar PDF
            </Button>
            <Button variant="outline" onClick={doPrint}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={openThermal}>
              <Receipt className="h-4 w-4" />
              Resumo 80 mm
            </Button>
          </div>
        )}
      </div>

      <div className="no-print flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3">
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          Relatório
          <Select
            aria-label="Tipo de relatório"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="h-9 w-80 max-w-full text-xs font-medium"
          >
            {REPORT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
        {usesPeriod && (
          <>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              De
              <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPeriodId("custom"); }} className="h-9 w-40 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              Até
              <Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPeriodId("custom"); }} className="h-9 w-40 text-xs" />
            </label>
            <div className="flex flex-wrap gap-1">
              {PERIODS.map((p) => (
                <Button key={p.id} size="sm" variant={periodId === p.id ? "primary" : "outline"} onClick={() => applyPeriod(p.id)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-[11px] font-semibold text-slate-600">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Comparar com o período anterior
            </label>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => void saveFavorite()} className="mb-0.5">
          <Star className="h-3.5 w-3.5" />
          Salvar favorito
        </Button>
      </div>

      {saved.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Favoritos</span>
          {saved.map((f) => (
            <span key={f.id} className="inline-flex items-center border border-slate-200 bg-white">
              <button type="button" className="px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50" onClick={() => openFavorite(f)}>{f.name}</button>
              <button type="button" aria-label={`Remover favorito ${f.name}`} className="border-l border-slate-200 px-1.5 py-1 text-slate-400 hover:text-red-600" onClick={() => void removeFavorite(f.id)}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      <Modal open={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? ""} size="lg">
        {drill?.rows === null ? (
          <p className="p-4 text-xs text-slate-500">Carregando…</p>
        ) : drill && drill.rows && drill.rows.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">Nenhuma venda encontrada.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>{["saleNumber", "date", "product", "quantity", "total", "operator", "customer"].map((k) => <th key={k} className="px-3 py-2">{columnLabel(k)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drill?.rows?.map((r, i) => (
                  <tr key={i}>
                    {["saleNumber", "date", "product", "quantity", "total", "operator", "customer"].map((k) => (
                      <td key={k} className={`px-3 py-2 ${["quantity", "total"].includes(k) ? "text-right font-mono" : ""}`}>{formatCell(k, r[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {drill?.rows && drill.rows.length >= 200 && <p className="p-3 text-[11px] text-slate-400">Mostrando as 200 vendas mais recentes.</p>}
          </div>
        )}
      </Modal>

      {/* Cabeçalho que só aparece na impressão */}
      <div className="print-only border-b border-slate-400 pb-3">
        <p className="text-base font-bold uppercase">{session?.company.tradeName}</p>
        <p className="text-xs">
          CNPJ {formatCnpjCpf(session?.company.cnpj)} · {session?.establishment.name}
        </p>
        <p className="mt-2 text-sm font-bold">{label}</p>
        <p className="text-xs">
          Período: {periodText} · Emitido em {emittedAt} por {session?.user.name}
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : loading ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">Gerando relatório…</div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Nada encontrado para este relatório{usesPeriod ? " no período escolhido" : ""}.
        </div>
      ) : (
        <>
          <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{c.label}</p>
                <p className={`mt-1 font-mono text-lg font-bold ${"strong" in c && c.strong ? "text-sky-700" : "text-slate-900"}`}>{c.value}</p>
                {"delta" in c && c.delta && (
                  <p className={`mt-0.5 text-[10px] ${"down" in c && c.down ? "text-red-600" : "text-emerald-700"}`}>{c.delta}</p>
                )}
              </div>
            ))}
          </div>

          {chart && <ReportChart spec={chart} />}

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="report-table w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  {keys.map((k) => (
                    <th key={k} className={`px-3 py-2 ${align(k)}`}>
                      {isStatement ? (
                        <span>{columnLabel(k)}</span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-semibold uppercase hover:text-slate-900"
                          onClick={() => setSort((s) => (s?.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }))}
                        >
                          {columnLabel(k)}
                          {sort?.key === k && (sort.dir === 1 ? <ArrowUp className="no-print h-3 w-3" /> : <ArrowDown className="no-print h-3 w-3" />)}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((r, i) => (
                  <tr
                    key={i}
                    className={`${r._bold ? "bg-slate-50 font-bold" : ""} ${DRILL[reportType] ? "cursor-pointer hover:bg-sky-50" : ""}`}
                    onClick={DRILL[reportType] ? () => void openDrill(r) : undefined}
                    title={DRILL[reportType] ? "Ver as vendas desta linha" : undefined}
                  >
                    {keys.map((k) => {
                      const v = r[k];
                      const neg = typeof v === "number" && v < 0 && columnKind(k) === "money";
                      return (
                        <td
                          key={k}
                          className={`px-3 py-2 ${align(k)} ${columnKind(k) === "money" ? "font-mono" : ""} ${neg ? "text-red-700" : ""} ${isStatement && k === "description" ? "whitespace-pre" : ""}`}
                        >
                          {formatCell(k, v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {showTotals && (
                <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <tr>
                    {keys.map((k, i) => (
                      <td key={k} className={`px-3 py-2 ${align(k)} ${k in totals ? "font-mono" : ""}`}>
                        {i === 0 ? "TOTAL" : k in totals ? formatCell(k, totals[k]) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {SIGN.has(reportType) && (
            <div className="print-signature hidden">
              <div>Responsável pela contagem</div>
              <div>Conferido por</div>
            </div>
          )}
        </>
      )}

      <Modal
        open={thermalOpen}
        onClose={() => setThermalOpen(false)}
        title="Resumo em 80 mm"
        size="sm"
        footer={<><Button variant="outline" onClick={() => setThermalOpen(false)}>Fechar</Button><Button variant="warning" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Imprimir / salvar PDF</Button></>}
      >
        <ReportThermal
          company={session?.company.tradeName ?? ""}
          cnpj={formatCnpjCpf(session?.company.cnpj)}
          establishment={session?.establishment.name ?? ""}
          title={label}
          periodText={periodText}
          emittedAt={emittedAt}
          emittedBy={session?.user.name ?? ""}
          keys={keys}
          rows={sorted}
          totals={showTotals ? totals : {}}
          signature={SIGN.has(reportType)}
        />
      </Modal>
    </div>
  );
}
