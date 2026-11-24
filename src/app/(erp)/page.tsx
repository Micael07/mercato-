"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, ShoppingCart, ArrowRight, AlertTriangle } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { formatCurrency } from "@/lib/format";
import { formatQuantity } from "@/lib/pos";
import { Badge, Button, Panel, Select } from "@/components/ui/primitives";

interface DashboardData {
  permissions: { canFinance: boolean; canCost: boolean; canSales: boolean };
  kpis: {
    salesTodayTotal: number; salesMonthTotal: number; periodTotal: number; prevPeriodTotal: number;
    avgTicket: number; salesCount: number; productsSoldCount: number; cashBalance: number; openRegistersCount: number;
    lowStockCount: number; zeroStockCount: number; pendingPurchasesCount: number;
    accountsReceivable: number | null; accountsPayable: number | null; expensesPeriod: number | null;
  };
  charts: {
    salesByDay: Array<{ date: string; total: number }>;
    salesByPayment: Array<{ name: string; total: number }>;
    topProducts: Array<{ name: string; quantity: number; total: number }>;
    topCategories: Array<{ name: string; total: number }>;
    operatorPerformance: Array<{ name: string; count: number; total: number }>;
  };
  alerts: {
    lowStockItems: Array<{ id: string; name: string; sku: string; unit: string; quantity: number; minStock: number }>;
    zeroStockItems: Array<{ id: string; name: string; sku: string; unit: string; quantity: number }>;
  };
}

export default function DashboardPage() {
  const { session, hasPermission } = useSession();
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<"operators" | "categories">("operators");
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/dashboard?days=${days}`, { cache: "no-store", signal: abort.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Não foi possível consultar o resumo. Tente atualizar a página."); return await response.json() as DashboardData; })
      .then((result) => { if (!abort.signal.aborted) { setData(result); setError(null); } })
      .catch((failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Falha ao consultar o resumo."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [days, revision, session?.company.id, session?.establishment.id]);

  const k = data?.kpis;
  const maximum = Math.max(1, ...(data?.charts.salesByDay.map((day) => day.total) || []));
  const salesExist = data?.charts.salesByDay.some((day) => day.total > 0);
  const paymentsTotal = data?.charts.salesByPayment.reduce((sum, method) => sum + method.total, 0) || 0;
  const stockAlerts = [...(data?.alerts.zeroStockItems || []).map((item) => ({ ...item, zero: true })), ...(data?.alerts.lowStockItems || []).map((item) => ({ ...item, zero: false }))];
  const change = k && k.prevPeriodTotal > 0 ? ((k.periodTotal - k.prevPeriodTotal) / k.prevPeriodTotal) * 100 : null;
  const value = (amount: number | null | undefined) => loading ? "—" : formatCurrency(amount);

  return (
    <div className="space-y-4">
      <div className="overview-bar"><h1><BarChart3 className="h-[18px] w-[18px]" />Visão geral</h1><div className="flex flex-wrap items-center gap-2"><Select aria-label="Período de análise" className="!h-[31px] !w-36 !text-[11px]" value={days} onChange={(event) => { setLoading(true); setDays(Number(event.target.value)); }}><option value={7}>Últimos 7 dias</option><option value={15}>Últimos 15 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></Select><Button variant="outline" size="sm" loading={loading} onClick={() => { setLoading(true); setRevision((count) => count + 1); }}><RefreshCw className="h-3 w-3" />Atualizar</Button>{hasPermission("sales.create") && <Link href="/pdv" className="erp-button erp-button--primary erp-button--sm"><ShoppingCart className="h-3.5 w-3.5" />Ponto de venda</Link>}</div></div>
      {error && <p role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-slate-400">Resumo de <span className="text-slate-500">{session?.establishment.name}</span> · {session?.company.tradeName}</p>
      {(!data || data.permissions.canSales) && <section className="overview-summary" aria-label="Resumo das operações"><div><p>Vendas de hoje</p><strong>{value(k?.salesTodayTotal)}</strong><small>Mês atual: {value(k?.salesMonthTotal)}</small></div><div><p>Vendas no período</p><strong>{value(k?.periodTotal)}</strong><small>{loading ? "Consultando…" : `${k?.salesCount || 0} vendas concluídas`}{change !== null && !loading ? ` · ${change >= 0 ? "+" : ""}${change.toFixed(1)}% no comparativo` : ""}</small></div><div><p>Ticket médio</p><strong>{value(k?.avgTicket)}</strong><small>{loading ? "Consultando…" : `${formatQuantity(k?.productsSoldCount || 0)} itens vendidos no período`}</small></div><div><p>Saldo em dinheiro</p><strong>{value(k?.cashBalance)}</strong><small>{loading ? "Consultando…" : `${k?.openRegistersCount || 0} caixa(s) aberto(s)`}</small></div></section>}
      {data?.permissions.canFinance && <Panel title="Posição financeira" noPadding><div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="flex items-center justify-between gap-3 px-4 py-4"><span className="text-[11px] text-slate-400">Contas a receber</span><strong className="text-sm font-medium tabular-nums text-emerald-600">{value(k?.accountsReceivable)}</strong></div><div className="flex items-center justify-between gap-3 px-4 py-4"><span className="text-[11px] text-slate-400">Contas a pagar</span><strong className="text-sm font-medium tabular-nums text-red-500">{value(k?.accountsPayable)}</strong></div><div className="flex items-center justify-between gap-3 px-4 py-4"><span className="text-[11px] text-slate-400">Despesas do período</span><strong className="text-sm font-medium tabular-nums text-slate-600">{value(k?.expensesPeriod)}</strong></div></div></Panel>}
      {data?.permissions.canSales && <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3"><Panel title="Vendas por dia" subtitle={`Faturamento das vendas concluídas · últimos ${days} dias`} className="lg:col-span-2">{!salesExist ? <div className="overview-empty">Nenhuma venda concluída no período selecionado.</div> : <><div className="flex h-[178px] gap-3 pt-2" role="img" aria-label={`Vendas por dia no período. Total: ${formatCurrency(k?.periodTotal)}`}><div className="flex w-20 shrink-0 flex-col justify-between pb-1 text-right text-[9px] text-slate-400"><span>{formatCurrency(maximum)}</span><span>{formatCurrency(maximum / 2)}</span><span>R$ 0,00</span></div><div className="relative flex min-w-0 flex-1 items-end gap-1 border-b border-l border-[#dce8ef] px-2"><div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-[#edf2f5]" /><div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[#edf2f5]" />{data.charts.salesByDay.map((day) => <div key={day.date} title={`${day.date.split("-").reverse().join("/")}: ${formatCurrency(day.total)}`} className="relative flex-1 bg-[#58b8df] hover:bg-[#168dc1]" style={{ height: `${day.total > 0 ? Math.max(2, (day.total / maximum) * 100) : 1}%`, minWidth: 2, opacity: day.total ? 1 : .2 }} />)}</div></div><div className="ml-[92px] mt-2 flex justify-between text-[9px] text-slate-400">{[data.charts.salesByDay[0], data.charts.salesByDay[Math.floor(data.charts.salesByDay.length / 2)], data.charts.salesByDay.at(-1)].filter((day) => Boolean(day)).map((day) => <span key={day!.date}>{day!.date.slice(8)}/{day!.date.slice(5, 7)}</span>)}</div></>}</Panel><Panel title="Pagamentos registrados" subtitle="Distribuição por forma de pagamento" noPadding>{!data.charts.salesByPayment.length ? <div className="overview-empty">Sem pagamentos no período.</div> : <><table className="overview-table"><thead><tr><th>Forma</th><th className="text-right">Valor</th><th className="text-right">%</th></tr></thead><tbody>{data.charts.salesByPayment.map((method) => <tr key={method.name}><td>{method.name}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(method.total)}</td><td className="text-right tabular-nums text-slate-400">{paymentsTotal ? ((method.total / paymentsTotal) * 100).toFixed(0) : 0}%</td></tr>)}</tbody></table><p className="border-t border-slate-100 px-3 py-3 text-[10px] leading-relaxed text-slate-400">Valores informados nos pagamentos. O troco está discriminado em cada venda.</p></>}</Panel></div>}
      <div className={`grid min-w-0 grid-cols-1 gap-4 ${data?.permissions.canSales ? "xl:grid-cols-3" : ""}`}>
        {data?.permissions.canSales && <Panel title="Produtos mais vendidos" subtitle="Classificação pelo valor vendido" noPadding>{data.charts.topProducts.length ? <table className="overview-table"><thead><tr><th>Descrição</th><th className="text-right">Qtd.</th><th className="text-right">Total</th></tr></thead><tbody>{data.charts.topProducts.map((product) => <tr key={product.name}><td><span className="block max-w-[220px] truncate" title={product.name}>{product.name}</span></td><td className="text-right tabular-nums">{formatQuantity(product.quantity)}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(product.total)}</td></tr>)}</tbody></table> : <div className="overview-empty">Sem produtos vendidos no período.</div>}</Panel>}
        <Panel title="Acompanhamento de estoque" actions={<Link href="/produtos" className="inline-flex items-center gap-1 text-[10px] text-sky-600 hover:underline">Ver produtos<ArrowRight className="h-3 w-3" /></Link>} noPadding><div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-[10px] text-slate-400"><span><span className="font-medium text-amber-600">{k?.lowStockCount || 0}</span> abaixo do mínimo</span><span><span className="font-medium text-red-500">{k?.zeroStockCount || 0}</span> sem estoque</span><span>{k?.pendingPurchasesCount || 0} compras pendentes</span></div>{!data ? <div className="overview-empty">Consultando estoque…</div> : stockAlerts.length ? <table className="overview-table"><thead><tr><th>Produto</th><th className="text-right">Saldo</th><th className="text-right">Situação</th></tr></thead><tbody>{stockAlerts.slice(0, 6).map((item) => <tr key={item.id}><td><span className="block max-w-[210px] truncate" title={item.name}>{item.name}</span><span className="mt-1 block text-[9px] text-slate-400">{item.sku}</span></td><td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(item.quantity)} {item.unit}</td><td className="text-right"><Badge tone={item.zero ? "danger" : "warning"}>{item.zero ? "Sem estoque" : "Estoque baixo"}</Badge></td></tr>)}</tbody></table> : <div className="overview-empty"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-slate-300" />Nenhum alerta de estoque no momento.</span></div>}</Panel>
        {data?.permissions.canSales && <Panel title="Análise de vendas" actions={<div className="flex gap-1"><button className={`border-b px-1 py-0.5 text-[10px] ${analysis === "operators" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400"}`} type="button" aria-pressed={analysis === "operators"} onClick={() => setAnalysis("operators")}>Operadores</button><button className={`border-b px-1 py-0.5 text-[10px] ${analysis === "categories" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400"}`} type="button" aria-pressed={analysis === "categories"} onClick={() => setAnalysis("categories")}>Categorias</button></div>} noPadding>{(analysis === "operators" ? data.charts.operatorPerformance.length : data.charts.topCategories.length) ? <table className="overview-table"><thead><tr><th>{analysis === "operators" ? "Operador" : "Categoria"}</th>{analysis === "operators" && <th className="text-right">Vendas</th>}<th className="text-right">Total</th></tr></thead><tbody>{analysis === "operators" ? data.charts.operatorPerformance.map((operator) => <tr key={operator.name}><td>{operator.name}</td><td className="text-right tabular-nums">{operator.count}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(operator.total)}</td></tr>) : data.charts.topCategories.map((category) => <tr key={category.name}><td>{category.name}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(category.total)}</td></tr>)}</tbody></table> : <div className="overview-empty">Sem vendas para analisar neste período.</div>}</Panel>}
      </div>
    </div>
  );
}
