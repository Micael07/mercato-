"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Printer } from "lucide-react";
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
import { Button, Input, Select } from "@/components/ui/primitives";

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
    ],
  },
  {
    label: "Estoque",
    items: [
      { value: "current_stock", label: "Posição de estoque atual" },
      { value: "low_stock", label: "Produtos abaixo do estoque mínimo" },
      { value: "stock_movements", label: "Movimentação de estoque" },
      { value: "inventories", label: "Histórico de inventários" },
    ],
  },
  {
    label: "Compras",
    items: [
      { value: "purchases_supplier", label: "Compras por fornecedor" },
      { value: "purchases_period", label: "Compras por período" },
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
const NO_PERIOD = new Set(["current_stock", "low_stock", "inventories"]);

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
    } finally {
      setLoading(false);
    }
  }, [reportType, from, to]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

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
    const out = [{ label: "Registros", value: String(rows.length) }];
    for (const k of totalKeys.slice(0, 3)) {
      out.push({ label: `Total · ${columnLabel(k)}`, value: formatCell(k, totals[k]) });
    }
    return out;
  }, [rows, isStatement, totalKeys, totals]);

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
  };

  const doPrint = () => {
    setEmittedAt(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="space-y-4">
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
            <Button variant="outline" onClick={doPrint}>
              <Printer className="h-4 w-4" />
              Imprimir
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
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              Até
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-xs" />
            </label>
            <div className="flex flex-wrap gap-1">
              {PERIODS.map((p) => (
                <Button key={p.id} size="sm" variant="outline" onClick={() => applyPeriod(p.id)}>
                  {p.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

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
              </div>
            ))}
          </div>

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
                  <tr key={i} className={r._bold ? "bg-slate-50 font-bold" : ""}>
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
        </>
      )}
    </div>
  );
}
