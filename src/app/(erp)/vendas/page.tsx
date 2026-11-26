"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, Eye, Printer, RotateCcw, XCircle } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import {
  downloadCsv,
  formatCurrency,
  formatDateTime,
} from "@/lib/format";
import {
  Badge,
  BadgeTone,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";
import { ReceiptData, ThermalReceipt } from "@/components/thermal-receipt";

interface SaleRow {
  id: string;
  saleNumber: number;
  customerName: string | null;
  operatorName: string | null;
  status: string;
  subtotal: number;
  discountTotal: number;
  surchargeTotal: number;
  total: number;
  createdAt: string;
  payments: Array<{ name: string; code: string; amount: number }>;
}

interface SaleDetail {
  sale: SaleRow & {
    customerDocument: string | null;
    changeAmount: number;
    cancelReason: string | null;
  };
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    total: number;
    returnedQuantity: number;
  }>;
  payments: Array<{
    id: string;
    paymentMethodName: string;
    amount: number;
    installments: number;
  }>;
}

const STATUS_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Concluída", tone: "success" },
  suspended: { label: "Suspensa", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "danger" },
  partially_returned: { label: "Devolvida parcial", tone: "info" },
  returned: { label: "Devolvida", tone: "neutral" },
};

export default function VendasPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [items, setItems] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [operator, setOperator] = useState("all");
  const [payment, setPayment] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"items" | "payments" | "notes">("items");

  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [returnTarget, setReturnTarget] = useState<SaleDetail | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status !== "all") qs.set("status", status);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/sales?${qs.toString()}`);
      if (res.ok) {
        setItems((await res.json()).items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [status, from, to]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const openDetail = async (saleId: string, showReceipt = false) => {
    const res = await fetch(`/api/sales/${saleId}`);
    if (!res.ok) return;
    const data: SaleDetail = await res.json();
    if (showReceipt) {
      setReceipt({
        companyName: session?.company.tradeName ?? "",
        companyCnpj: session?.company.cnpj ?? "",
        establishmentName: session?.establishment.name ?? "",
        establishmentAddress: session?.establishment.address,
        establishmentPhone: session?.establishment.phone,
        saleNumber: data.sale.saleNumber,
        createdAt: data.sale.createdAt,
        operatorName: data.sale.operatorName || "Sistema",
        customerName: data.sale.customerName,
        customerDocument: data.sale.customerDocument,
        subtotal: data.sale.subtotal,
        discountTotal: data.sale.discountTotal,
        surchargeTotal: data.sale.surchargeTotal,
        total: data.sale.total,
        changeAmount: data.sale.changeAmount,
        receiptFooter: session?.settings.receiptFooter ?? "",
        items: data.items,
        payments: data.payments,
      });
    } else {
      setDetail(data);
    }
  };

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales/${cancelTarget.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error || "Erro ao cancelar venda" });
        return;
      }
      toast({ type: "success", title: "Venda cancelada e estoque estornado." });
      setCancelTarget(null);
      setCancelReason("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    const itemsToReturn = Object.entries(returnQtys)
      .filter(([, q]) => q > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (itemsToReturn.length === 0) {
      toast({ type: "warning", title: "Informe ao menos uma quantidade." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales/${returnTarget.sale.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "return",
          items: itemsToReturn,
          reason: returnReason || "Devolução de cliente",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Devolução registrada no estoque!" });
      setReturnTarget(null);
      setReturnQtys({});
      setReturnReason("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const operators = Array.from(new Set(items.map((s) => s.operatorName).filter(Boolean))) as string[];
  const methods = Array.from(new Set(items.flatMap((s) => s.payments.map((p) => p.name))));
  const visibleSales = items.filter((s) => {
    if (operator !== "all" && s.operatorName !== operator) return false;
    if (payment !== "all" && !s.payments.some((p) => p.name === payment)) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${s.saleNumber} ${s.customerName ?? "consumidor final"}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const valid = visibleSales.filter((s) => ["completed", "partially_returned"].includes(s.status));
  const revenue = valid.reduce((sum, s) => sum + s.total, 0);
  const discounts = valid.reduce((sum, s) => sum + s.discountTotal, 0);
  const cancelledCount = visibleSales.filter((s) => s.status === "cancelled").length;

  const columns: ColumnDef<SaleRow>[] = [
    {
      key: "saleNumber",
      header: "Nº",
      sortable: true,
      sortValue: (r) => r.saleNumber,
      render: (r) => (
        <span className="font-mono font-semibold text-slate-900">
          #{r.saleNumber}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Data / Hora",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => formatDateTime(r.createdAt),
    },
    {
      key: "customerName",
      header: "Cliente",
      sortable: true,
      sortValue: (r) => r.customerName || "Consumidor final",
      render: (r) => r.customerName || "Consumidor final",
    },
    {
      key: "operatorName",
      header: "Operador",
      render: (r) => r.operatorName || "—",
    },
    {
      key: "payments",
      header: "Pagamento",
      render: (r) =>
        r.payments.length > 0
          ? r.payments.map((p) => p.name).join(" + ")
          : "—",
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      sortValue: (r) => r.total,
      render: (r) => (
        <span className="font-semibold tabular-nums text-slate-900">
          {formatCurrency(r.total)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const st = STATUS_MAP[r.status] ?? { label: r.status, tone: "neutral" as BadgeTone };
        return <Badge tone={st.tone}>{st.label}</Badge>;
      },
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      hideable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            title="Detalhes"
            onClick={() => openDetail(r.id, false)}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Reimprimir cupom"
            onClick={() => openDetail(r.id, true)}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
          {hasPermission("sales.cancel") && r.status !== "cancelled" && (
            <Button
              size="sm"
              variant="ghost"
              title="Cancelar venda"
              onClick={() => setCancelTarget(r)}
            >
              <XCircle className="h-3.5 w-3.5 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Vendas</h1>
          <p className="text-xs text-slate-500">
            Histórico de vendas, reimpressão de cupons, devoluções e cancelamentos
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              "vendas-mercato",
              ["Nº", "Data", "Cliente", "Operador", "Subtotal", "Desconto", "Total", "Status"],
              items.map((s) => [
                s.saleNumber,
                formatDateTime(s.createdAt),
                s.customerName || "Consumidor final",
                s.operatorName || "",
                s.subtotal,
                s.discountTotal,
                s.total,
                s.status,
              ])
            )
          }
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="kpi-strip no-print" aria-label="Resumo das vendas listadas">
        <div><p>Receita</p><strong>{formatCurrency(revenue)}</strong><small>{valid.length} venda(s) válida(s)</small></div>
        <div><p>Ticket médio</p><strong>{formatCurrency(valid.length ? revenue / valid.length : 0)}</strong><small>por venda concluída</small></div>
        <div><p>Descontos concedidos</p><strong>{formatCurrency(discounts)}</strong><small>{(revenue + discounts > 0 ? (discounts / (revenue + discounts)) * 100 : 0).toFixed(1).replace(".", ",")}% do bruto</small></div>
        <div><p>Canceladas</p><strong>{cancelledCount}</strong><small>no filtro atual</small></div>
      </div>

      <div className="no-print">
        <DataTable
          data={visibleSales}
          columns={columns}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => { setTab("items"); void openDetail(r.id, false); }}
          toolbar={
            <>
              <Select
                aria-label="Filtrar status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-8 w-44 text-xs"
              >
                <option value="all">Todos os status</option>
                <option value="completed">Concluídas</option>
                <option value="suspended">Suspensas</option>
                <option value="partially_returned">Devolvidas parcial</option>
                <option value="returned">Devolvidas</option>
                <option value="cancelled">Canceladas</option>
              </Select>
              <Input
                aria-label="Buscar por número ou cliente"
                placeholder="Buscar nº ou cliente"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-44 text-xs"
              />
              <Select aria-label="Filtrar operador" value={operator} onChange={(e) => setOperator(e.target.value)} className="h-8 w-40 text-xs">
                <option value="all">Todos os operadores</option>
                {operators.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
              <Select aria-label="Filtrar pagamento" value={payment} onChange={(e) => setPayment(e.target.value)} className="h-8 w-40 text-xs">
                <option value="all">Todas as formas</option>
                {methods.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Input
                type="date"
                aria-label="Data inicial"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <Input
                type="date"
                aria-label="Data final"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </>
          }
        />
      </div>

      {/* Sale detail modal */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Venda #${detail.sale.saleNumber}` : ""}
        subtitle={
          detail
            ? `${formatDateTime(detail.sale.createdAt)} · Operador: ${detail.sale.operatorName || "Sistema"}`
            : undefined
        }
        size="lg"
        footer={
          detail && (
            <>
              {hasPermission("sales.cancel") &&
                detail.sale.status !== "cancelled" &&
                detail.sale.status !== "suspended" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReturnTarget(detail);
                      setDetail(null);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Devolução
                  </Button>
                )}
              <Button variant="outline" onClick={() => setDetail(null)}>
                Fechar
              </Button>
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
              <div>
                <p className="text-slate-500">Cliente</p>
                <p className="font-semibold text-slate-900">
                  {detail.sale.customerName || "Consumidor final"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Subtotal</p>
                <p className="font-semibold tabular-nums">
                  {formatCurrency(detail.sale.subtotal)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Desconto</p>
                <p className="font-semibold tabular-nums">
                  {formatCurrency(detail.sale.discountTotal)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Total líquido</p>
                <p className="font-bold tabular-nums text-slate-900">
                  {formatCurrency(detail.sale.total)}
                </p>
              </div>
            </div>

            {detail.sale.cancelReason && (
              <div className="rounded border border-red-200 bg-red-50 p-2.5 text-red-700">
                <strong>Motivo do cancelamento:</strong> {detail.sale.cancelReason}
              </div>
            )}

            <div className="erp-tabs" role="tablist" aria-label="Detalhes da venda">
              {([["items", `Itens (${detail.items.length})`], ["payments", `Pagamentos (${detail.payments.length})`], ["notes", "Observações"]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>

            {tab === "items" && (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                    <th className="px-2 py-2">Produto</th>
                    <th className="px-2 py-2 text-right">Qtd</th>
                    <th className="px-2 py-2 text-right">Devolvido</th>
                    <th className="px-2 py-2 text-right">Unitário</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-2 py-2 font-medium">
                        {it.productName} <span className="text-[11px] text-slate-400">({it.sku})</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-700">{it.returnedQuantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(it.unitPrice)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "payments" && (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                    <th className="px-2 py-2">Forma de pagamento</th>
                    <th className="px-2 py-2 text-right">Parcelas</th>
                    <th className="px-2 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-2 py-2 font-medium">{p.paymentMethodName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.installments > 1 ? `${p.installments}x` : "À vista"}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                  {detail.sale.changeAmount > 0 && (
                    <tr>
                      <td className="px-2 py-2 text-slate-500" colSpan={2}>Troco devolvido</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">{formatCurrency(detail.sale.changeAmount)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === "notes" && (
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-xs">
                <dt className="text-slate-500">Status</dt>
                <dd>{(STATUS_MAP[detail.sale.status] ?? { label: detail.sale.status }).label}</dd>
                <dt className="text-slate-500">Operador</dt>
                <dd>{detail.sale.operatorName || "Sistema"}</dd>
                <dt className="text-slate-500">Data e hora</dt>
                <dd>{formatDateTime(detail.sale.createdAt)}</dd>
                <dt className="text-slate-500">Documento do cliente</dt>
                <dd>{detail.sale.customerDocument || "—"}</dd>
                <dt className="text-slate-500">Observações</dt>
                <dd>{(detail.sale as { notes?: string | null }).notes || "—"}</dd>
              </dl>
            )}
          </div>
        )}
      </Modal>

      {/* Cancel modal */}
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={`Cancelar Venda #${cancelTarget?.saleNumber ?? ""}`}
        size="sm"
      >
        <form onSubmit={handleCancel} className="space-y-4">
          <p className="text-xs text-slate-600">
            Esta operação estornará os itens para o estoque e cancelará eventuais
            títulos em aberto vinculados à venda.
          </p>
          <Field label="Motivo do cancelamento" required>
            <Textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ex.: Desistência do cliente / erro de lançamento"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Voltar
            </Button>
            <Button type="submit" variant="danger" loading={submitting}>
              Confirmar Cancelamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* Return modal */}
      <Modal
        open={Boolean(returnTarget)}
        onClose={() => setReturnTarget(null)}
        title={`Registrar Devolução — Venda #${returnTarget?.sale.saleNumber ?? ""}`}
        size="md"
      >
        {returnTarget && (
          <form onSubmit={handleReturn} className="space-y-4">
            <div className="space-y-2">
              {returnTarget.items.map((it) => {
                const max = Math.max(0, it.quantity - it.returnedQuantity);
                return (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold">{it.productName}</p>
                      <p className="text-slate-500">
                        Disponível para devolução: {max}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={max}
                      step="1"
                      className="w-24 font-mono"
                      value={returnQtys[it.id] ?? 0}
                      onChange={(e) =>
                        setReturnQtys((prev) => ({
                          ...prev,
                          [it.id]: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <Field label="Motivo da devolução" required>
              <Input
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Ex.: Troca de mercadoria"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReturnTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={submitting}>
                Confirmar Devolução
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Thermal receipt */}
      <Modal
        open={Boolean(receipt)}
        onClose={() => setReceipt(null)}
        title="Reimpressão de Cupom"
        size="sm"
        footer={
          <div className="no-print flex gap-2">
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Fechar
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
          </div>
        }
      >
        {receipt && <ThermalReceipt data={receipt} />}
      </Modal>
    </div>
  );
}
