"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw, ShoppingCart, ArrowRight, AlertTriangle, User, CalendarClock, Clock, ArrowUp, ArrowDown, Wallet, HandCoins, Receipt, PackageSearch } from "lucide-react";
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
    expensesMonth: number | null; prevExpensesMonth: number | null; prevMonthTotal: number;
  };
  finance: null | Record<"overdue" | "today" | "upcoming", { receivable: number; payable: number; receivableCount: number; payableCount: number }>;
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

const DONUT_COLORS = ["#1d6fa5", "#58b8df", "#e8a33d", "#d6577a", "#7b8ea3", "#a9c7dc"];

function Money({ amount, negative, tone }: { amount: number | null | undefined; negative?: boolean; tone?: "blue" | "red" | "ink" }) {
  const text = formatCurrency(Math.abs(amount ?? 0));
  const cut = text.lastIndexOf(",");
  return <span className={`dash-money dash-money--${tone || "ink"}`}>{negative && (amount ?? 0) > 0 ? "−" : ""}{cut > 0 ? text.slice(0, cut) : text}{cut > 0 && <small>{text.slice(cut)}</small>}</span>;
}

function Delta({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  if (!(previous > 0)) return null;
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  const good = inverse ? !up : up;
  return <span className={`dash-delta ${good ? "dash-delta--good" : "dash-delta--bad"}`} title="Comparado ao mesmo intervalo do mês anterior">{up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(pct).toFixed(0)}%</span>;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || !values.some((v) => v > 0)) return <div className="dash-spark-empty">Sem vendas no período</div>;
  const max = Math.max(...values), w = 220, h = 56, pad = 4;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return <svg className="dash-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Vendas diárias no período"><defs><linearGradient id="dash-spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1d6fa5" stopOpacity=".22" /><stop offset="1" stopColor="#1d6fa5" stopOpacity="0" /></linearGradient></defs><path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#dash-spark-fill)" /><path d={line} fill="none" stroke="#1d6fa5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}

function Donut({ rows }: { rows: Array<{ name: string; total: number }> }) {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const r = 52, c = 2 * Math.PI * r;
  const offsets = rows.map((_, i) => rows.slice(0, i).reduce((a, x) => a + (total ? (x.total / total) * c : 0), 0));
  return <div className="dash-donut-wrap"><svg viewBox="0 0 140 140" className="dash-donut" role="img" aria-label="Participação das categorias nas vendas"><circle cx="70" cy="70" r={r} fill="none" stroke="#eef3f7" strokeWidth="18" />{rows.map((row, i) => { const len = total ? (row.total / total) * c : 0; return <circle key={row.name} cx="70" cy="70" r={r} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 70 70)" />; })}</svg><ul className="dash-legend">{rows.map((row, i) => <li key={row.name}><i style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} /><span className="truncate" title={row.name}>{i + 1}. {row.name}</span><em>{total ? ((row.total / total) * 100).toFixed(1).replace(".", ",") : 0}%</em><b>{formatCurrency(row.total)}</b></li>)}</ul></div>;
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

  const fin = data?.finance;
  const firstName = (session?.user.name || "").trim().split(/\s+/)[0] || "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  let notice: { text: string; tone: "warn" | "ok" } | null = null;
  if (data && fin && fin.today.payable > 0) notice = { text: `Você tem contas a pagar hoje no total de ${formatCurrency(fin.today.payable)}.`, tone: "warn" };
  else if (data && fin && fin.overdue.payable > 0) notice = { text: `Há contas em atraso no total de ${formatCurrency(fin.overdue.payable)}.`, tone: "warn" };
  else if (data && (k?.zeroStockCount || 0) > 0) notice = { text: `${k?.zeroStockCount} produto(s) sem estoque precisam de reposição.`, tone: "warn" };
  else if (data) notice = { text: "Nenhum vencimento ou alerta urgente para hoje.", tone: "ok" };
  const sparkValues = data?.charts.salesByDay.map((day) => day.total) || [];
  const statusCards = fin ? [
    { key: "overdue", title: "Vencidos", hint: "Em atraso", icon: <AlertTriangle className="h-[22px] w-[22px] text-[#d6577a]" />, data: fin.overdue },
    { key: "today", title: "Vencendo", hint: "Hoje", icon: <CalendarClock className="h-[22px] w-[22px] text-[#1d6fa5]" />, data: fin.today },
    { key: "upcoming", title: "Futuro", hint: "Próximos 14 dias", icon: <Clock className="h-[22px] w-[22px] text-[#e8a33d]" />, data: fin.upcoming },
  ] : [];

  return (
    <div className="dash space-y-4">
      <header className="dash-head"><div className="dash-avatar" aria-hidden="true"><User className="h-6 w-6" /></div><div className="min-w-0 flex-1"><h1>{greeting}{firstName ? `, ${firstName}` : ""}</h1>{notice ? <p className={notice.tone === "warn" ? "dash-notice dash-notice--warn" : "dash-notice"}>{notice.tone === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}{notice.text}</p> : <p className="dash-notice">Consultando informações…</p>}<p className="dash-context">{session?.establishment.name} · {session?.company.tradeName}</p></div><div className="flex flex-wrap items-center gap-2"><Select aria-label="Período de análise" className="!h-[34px] !w-36 !text-[11px]" value={days} onChange={(event) => { setLoading(true); setDays(Number(event.target.value)); }}><option value={7}>Últimos 7 dias</option><option value={15}>Últimos 15 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></Select><Button variant="outline" size="sm" loading={loading} onClick={() => { setLoading(true); setRevision((count) => count + 1); }}><RefreshCw className="h-3 w-3" />Atualizar</Button>{hasPermission("sales.create") && <Link href="/pdv" className="erp-button erp-button--primary erp-button--sm"><ShoppingCart className="h-3.5 w-3.5" />Ponto de venda</Link>}</div></header>
      {error && <p role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">{error}</p>}
      <section className="dash-row dash-row--hero" aria-label="Resumo do mês">
        <div className="dash-card dash-card--balance"><p className="dash-label">Saldo em caixa</p><div className="dash-balance"><strong><Money amount={loading ? null : k?.cashBalance} tone="blue" /></strong><div className="dash-spark-box"><Sparkline values={sparkValues} /><span>Vendas diárias · {days} dias</span></div></div><p className="dash-sub">{loading ? "Consultando…" : `${k?.openRegistersCount || 0} caixa(s) aberto(s)`}</p></div>
        <div className="dash-card dash-card--pair"><div><p className="dash-label">{data?.permissions.canFinance ? "Receitas no mês" : "Vendas no mês"}</p><div className="dash-pair-value"><Money amount={loading ? null : k?.salesMonthTotal} tone="blue" />{k && !loading && <Delta current={k.salesMonthTotal} previous={k.prevMonthTotal} />}</div></div>{data?.permissions.canFinance && <div><p className="dash-label">Despesas no mês</p><div className="dash-pair-value"><Money amount={loading ? null : k?.expensesMonth} negative tone="red" />{k && !loading && k.expensesMonth !== null && k.prevExpensesMonth !== null && <Delta current={k.expensesMonth} previous={k.prevExpensesMonth} inverse />}</div></div>}</div>
      </section>
      {(!data || data.permissions.canSales) && <section className="dash-row dash-row--three" aria-label="Indicadores de vendas"><div className="dash-card dash-card--stat"><p className="dash-label">Vendas de hoje</p><Money amount={loading ? null : k?.salesTodayTotal} /><span className="dash-sub">Mês atual: {value(k?.salesMonthTotal)}</span></div><div className="dash-card dash-card--stat"><p className="dash-label">Vendas no período</p><div className="dash-pair-value"><Money amount={loading ? null : k?.periodTotal} />{change !== null && !loading && <span className={`dash-delta ${change >= 0 ? "dash-delta--good" : "dash-delta--bad"}`}>{change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(change).toFixed(0)}%</span>}</div><span className="dash-sub">{loading ? "Consultando…" : `${k?.salesCount || 0} vendas concluídas`}</span></div><div className="dash-card dash-card--stat"><p className="dash-label">Ticket médio</p><Money amount={loading ? null : k?.avgTicket} /><span className="dash-sub">{loading ? "Consultando…" : `${formatQuantity(k?.productsSoldCount || 0)} itens vendidos`}</span></div></section>}
      {fin && <section className="dash-row dash-row--three" aria-label="Vencimentos">{statusCards.map((card) => <Link key={card.key} href="/financeiro" className="dash-card dash-card--status">{card.icon}<p className="dash-status-title">{card.title}<span>{card.hint}</span></p><div className="dash-status-grid"><div><small>A receber</small><Money amount={card.data.receivable} tone={card.data.receivable ? "blue" : "ink"} /><em>{card.data.receivableCount} título(s)</em></div><div><small>A pagar</small><Money amount={card.data.payable} negative tone={card.data.payable ? "red" : "ink"} /><em>{card.data.payableCount} título(s)</em></div></div></Link>)}</section>}
      <section className="dash-row dash-row--split" aria-label="Contas e categorias"><div className="dash-card"><p className="dash-card-title">Posição das contas</p><ul className="dash-accounts"><li><span className="dash-ico"><Wallet className="h-[18px] w-[18px]" /></span><div><strong>Caixa</strong><small>{loading ? "Consultando…" : `${k?.openRegistersCount || 0} caixa(s) aberto(s)`}</small></div><Money amount={loading ? null : k?.cashBalance} tone="blue" /></li>{data?.permissions.canFinance && <><li><span className="dash-ico"><HandCoins className="h-[18px] w-[18px]" /></span><div><strong>A receber</strong><small>Total em aberto</small></div><Money amount={loading ? null : k?.accountsReceivable} tone="blue" /></li><li><span className="dash-ico"><Receipt className="h-[18px] w-[18px]" /></span><div><strong>A pagar</strong><small>Total em aberto</small></div><Money amount={loading ? null : k?.accountsPayable} negative tone="red" /></li></>}<li><span className="dash-ico"><PackageSearch className="h-[18px] w-[18px]" /></span><div><strong>Compras pendentes</strong><small>Pedidos em andamento</small></div><span className="dash-count">{loading ? "—" : k?.pendingPurchasesCount || 0}</span></li></ul></div>{(!data || data.permissions.canSales) && <div className="dash-card"><p className="dash-card-title">Principais categorias de vendas<span>últimos {days} dias</span></p>{data && data.charts.topCategories.length ? <Donut rows={data.charts.topCategories} /> : <div className="overview-empty">{data ? "Sem vendas para analisar neste período." : "Consultando…"}</div>}</div>}</section>
      {data?.permissions.canSales && <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3"><Panel title="Vendas por dia" subtitle={`Faturamento das vendas concluídas · últimos ${days} dias`} className="lg:col-span-2">{!salesExist ? <div className="overview-empty">Nenhuma venda concluída no período selecionado.</div> : <><div className="flex h-[178px] gap-3 pt-2" role="img" aria-label={`Vendas por dia no período. Total: ${formatCurrency(k?.periodTotal)}`}><div className="flex w-20 shrink-0 flex-col justify-between pb-1 text-right text-[9px] text-slate-400"><span>{formatCurrency(maximum)}</span><span>{formatCurrency(maximum / 2)}</span><span>R$ 0,00</span></div><div className="relative flex min-w-0 flex-1 items-end gap-1 border-b border-l border-[#dce8ef] px-2"><div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-[#edf2f5]" /><div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[#edf2f5]" />{data.charts.salesByDay.map((day) => <div key={day.date} title={`${day.date.split("-").reverse().join("/")}: ${formatCurrency(day.total)}`} className="relative flex-1 bg-[#58b8df] hover:bg-[#168dc1]" style={{ height: `${day.total > 0 ? Math.max(2, (day.total / maximum) * 100) : 1}%`, minWidth: 2, opacity: day.total ? 1 : .2 }} />)}</div></div><div className="ml-[92px] mt-2 flex justify-between text-[9px] text-slate-400">{[data.charts.salesByDay[0], data.charts.salesByDay[Math.floor(data.charts.salesByDay.length / 2)], data.charts.salesByDay.at(-1)].filter((day) => Boolean(day)).map((day) => <span key={day!.date}>{day!.date.slice(8)}/{day!.date.slice(5, 7)}</span>)}</div></>}</Panel><Panel title="Pagamentos registrados" subtitle="Distribuição por forma de pagamento" noPadding>{!data.charts.salesByPayment.length ? <div className="overview-empty">Sem pagamentos no período.</div> : <><table className="overview-table"><thead><tr><th>Forma</th><th className="text-right">Valor</th><th className="text-right">%</th></tr></thead><tbody>{data.charts.salesByPayment.map((method) => <tr key={method.name}><td>{method.name}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(method.total)}</td><td className="text-right tabular-nums text-slate-400">{paymentsTotal ? ((method.total / paymentsTotal) * 100).toFixed(0) : 0}%</td></tr>)}</tbody></table><p className="border-t border-slate-100 px-3 py-3 text-[10px] leading-relaxed text-slate-400">Valores informados nos pagamentos. O troco está discriminado em cada venda.</p></>}</Panel></div>}
      <div className={`grid min-w-0 grid-cols-1 gap-4 ${data?.permissions.canSales ? "xl:grid-cols-3" : ""}`}>
        {data?.permissions.canSales && <Panel title="Produtos mais vendidos" subtitle="Classificação pelo valor vendido" noPadding>{data.charts.topProducts.length ? <table className="overview-table"><thead><tr><th>Descrição</th><th className="text-right">Qtd.</th><th className="text-right">Total</th></tr></thead><tbody>{data.charts.topProducts.map((product) => <tr key={product.name}><td><span className="block max-w-[220px] truncate" title={product.name}>{product.name}</span></td><td className="text-right tabular-nums">{formatQuantity(product.quantity)}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(product.total)}</td></tr>)}</tbody></table> : <div className="overview-empty">Sem produtos vendidos no período.</div>}</Panel>}
        <Panel title="Acompanhamento de estoque" actions={<Link href="/produtos" className="inline-flex items-center gap-1 text-[10px] text-sky-600 hover:underline">Ver produtos<ArrowRight className="h-3 w-3" /></Link>} noPadding><div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-[10px] text-slate-400"><span><span className="font-medium text-amber-600">{k?.lowStockCount || 0}</span> abaixo do mínimo</span><span><span className="font-medium text-red-500">{k?.zeroStockCount || 0}</span> sem estoque</span><span>{k?.pendingPurchasesCount || 0} compras pendentes</span></div>{!data ? <div className="overview-empty">Consultando estoque…</div> : stockAlerts.length ? <table className="overview-table"><thead><tr><th>Produto</th><th className="text-right">Saldo</th><th className="text-right">Situação</th></tr></thead><tbody>{stockAlerts.slice(0, 6).map((item) => <tr key={item.id}><td><span className="block max-w-[210px] truncate" title={item.name}>{item.name}</span><span className="mt-1 block text-[9px] text-slate-400">{item.sku}</span></td><td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(item.quantity)} {item.unit}</td><td className="text-right"><Badge tone={item.zero ? "danger" : "warning"}>{item.zero ? "Sem estoque" : "Estoque baixo"}</Badge></td></tr>)}</tbody></table> : <div className="overview-empty"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-slate-300" />Nenhum alerta de estoque no momento.</span></div>}</Panel>
        {data?.permissions.canSales && <Panel title="Análise de vendas" actions={<div className="flex gap-1"><button className={`border-b px-1 py-0.5 text-[10px] ${analysis === "operators" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400"}`} type="button" aria-pressed={analysis === "operators"} onClick={() => setAnalysis("operators")}>Operadores</button><button className={`border-b px-1 py-0.5 text-[10px] ${analysis === "categories" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400"}`} type="button" aria-pressed={analysis === "categories"} onClick={() => setAnalysis("categories")}>Categorias</button></div>} noPadding>{(analysis === "operators" ? data.charts.operatorPerformance.length : data.charts.topCategories.length) ? <table className="overview-table"><thead><tr><th>{analysis === "operators" ? "Operador" : "Categoria"}</th>{analysis === "operators" && <th className="text-right">Vendas</th>}<th className="text-right">Total</th></tr></thead><tbody>{analysis === "operators" ? data.charts.operatorPerformance.map((operator) => <tr key={operator.name}><td>{operator.name}</td><td className="text-right tabular-nums">{operator.count}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(operator.total)}</td></tr>) : data.charts.topCategories.map((category) => <tr key={category.name}><td>{category.name}</td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(category.total)}</td></tr>)}</tbody></table> : <div className="overview-empty">Sem vendas para analisar neste período.</div>}</Panel>}
      </div>
    </div>
  );
}
