"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { useSession } from "@/components/session-provider";
import {
  downloadCsv,
  downloadExcelXml,
  formatCurrency,
  formatDateTime,
} from "@/lib/format";
import { Button, Input, Select } from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

const REPORT_TYPES = [
  { value: "sales_period", label: "Vendas por período" },
  { value: "sales_product", label: "Vendas por produto" },
  { value: "sales_category", label: "Vendas por categoria" },
  { value: "sales_operator", label: "Vendas por operador / Ticket médio" },
  { value: "sales_customer", label: "Vendas por cliente" },
  { value: "sales_payment", label: "Vendas por forma de pagamento" },
  { value: "top_products", label: "Produtos mais vendidos" },
  { value: "stagnant_products", label: "Produtos sem giro no período" },
  { value: "current_stock", label: "Posição de estoque atual" },
  { value: "low_stock", label: "Produtos abaixo do estoque mínimo" },
  { value: "stock_movements", label: "Movimentação de estoque" },
  { value: "inventories", label: "Histórico de inventários" },
  { value: "purchases_supplier", label: "Compras por fornecedor" },
  { value: "purchases_period", label: "Compras por período" },
  { value: "payables", label: "Contas a pagar" },
  { value: "receivables", label: "Contas a receber" },
  { value: "cash_flow", label: "Fluxo de caixa detalhado" },
  { value: "expenses_category", label: "Despesas por categoria" },
  { value: "establishment_performance", label: "Desempenho por estabelecimento" },
  { value: "gross_margin", label: "Margem bruta estimada" },
];

export default function RelatoriosPage() {
  const { session, hasPermission } = useSession();

  const [reportType, setReportType] = useState("sales_period");
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const moneyKeys = new Set([
    "subtotal",
    "discount",
    "total",
    "revenue",
    "cost",
    "grossProfit",
    "avgTicket",
    "salePrice",
    "costPrice",
    "stockSaleValue",
    "stockCostValue",
    "amount",
    "paidAmount",
    "paid",
  ]);

  const columns: ColumnDef<Record<string, unknown>>[] = keys.map((k) => {
    const isMoney = moneyKeys.has(k);
    const isNum =
      isMoney || ["quantity", "qty", "count", "salesCount", "minStock", "marginPercent"].includes(k);
    return {
      key: k,
      header: k.replace(/([A-Z])/g, " $1").toUpperCase(),
      align: isNum ? "right" : "left",
      sortable: true,
      sortValue: (r) =>
        typeof r[k] === "number" ? (r[k] as number) : String(r[k] ?? ""),
      render: (r) => {
        const v = r[k];
        if (v === null || v === undefined) return "—";
        if (isMoney) return <span className="font-mono font-semibold">{formatCurrency(v as number)}</span>;
        if (k === "marginPercent") return <span className="font-mono">{Number(v).toFixed(1)}%</span>;
        if (k === "date" || k === "createdAt" || k === "openedAt") {
          return formatDateTime(String(v));
        }
        return String(v);
      },
    };
  });

  const canExport = hasPermission("reports.export");

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
              onClick={() =>
                downloadCsv(
                  `relatorio-${reportType}`,
                  keys,
                  rows.map((r) => keys.map((k) => String(r[k] ?? "")))
                )
              }
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadExcelXml(
                  `relatorio-${reportType}`,
                  reportType,
                  keys,
                  rows.map((r) =>
                    keys.map((k) =>
                      typeof r[k] === "number"
                        ? (r[k] as number)
                        : String(r[k] ?? "")
                    )
                  )
                )
              }
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
          </div>
        )}
      </div>

      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => JSON.stringify(r)}
        loading={loading}
        error={error}
        configurableColumns={false}
        toolbar={
          <>
            <Select
              aria-label="Tipo de relatório"
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="h-8 w-72 text-xs font-medium"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </>
        }
      />
    </div>
  );
}
