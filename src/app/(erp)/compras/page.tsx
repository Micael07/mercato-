"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Eye, PackageCheck, Plus, Printer, Trash2 } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf, formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  PurchaseOrderDocData,
  PurchaseOrderDocument,
} from "@/components/purchase-order-document";
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

interface PurchaseOrderRow {
  id: string;
  orderNumber: number;
  supplierName: string | null;
  supplierLegalName: string;
  status: string;
  total: number;
  paymentTerms: string | null;
  expectedDelivery: string | null;
  createdAt: string;
}

interface PurchaseOrderItemDetail {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  total: number;
}

interface SupplierOption {
  id: string;
  tradeName: string | null;
  legalName: string;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  paymentTerms: string | null;
}

interface PurchaseOrderDetail {
  header: {
    companyName: string;
    companyCnpj: string;
    establishmentName: string;
    establishmentAddress: string | null;
    establishmentPhone: string | null;
  };
  order: {
    id: string;
    orderNumber: number;
    status: string;
    supplierName: string | null;
    supplierLegalName: string;
    supplierDocument: string | null;
    supplierContact: string | null;
    supplierPhone: string | null;
    supplierEmail: string | null;
    supplierAddress: string | null;
    supplierCity: string | null;
    supplierState: string | null;
    subtotal: number;
    discount: number;
    freight: number;
    taxes: number;
    total: number;
    paymentTerms: string | null;
    expectedDelivery: string | null;
    notes: string | null;
    createdByName: string | null;
    createdAt: string;
  };
  items: Array<PurchaseOrderItemDetail & { discount: number }>;
  receipts: Array<{
    id: string;
    invoiceNumber: string | null;
    receivedAt: string;
    receivedByName: string | null;
  }>;
}

const PO_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  pending_approval: { label: "Aguard. aprovação", tone: "warning" },
  approved: { label: "Aprovado", tone: "info" },
  sent: { label: "Enviado", tone: "primary" },
  partially_received: { label: "Recebido parcial", tone: "warning" },
  received: { label: "Recebido", tone: "success" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export default function ComprasPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<
    Array<{ id: string; sku: string; name: string; costPrice: number | null }>
  >([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [createModal, setCreateModal] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [poStatus, setPoStatus] = useState("approved");
  const [freight, setFreight] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [paymentTerms, setPaymentTerms] = useState("30 dias");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<
    Array<{ productId: string; quantityOrdered: string; unitCost: string; discount: string }>
  >([{ productId: "", quantityOrdered: "1", unitCost: "0", discount: "0" }]);

  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [printDoc, setPrintDoc] = useState<PurchaseOrderDocData | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [receiveModal, setReceiveModal] = useState<{
    order: PurchaseOrderRow;
    items: PurchaseOrderItemDetail[];
  } | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10)
  );
  const [generatePayable, setGeneratePayable] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [poRes, sRes, pRes] = await Promise.all([
        fetch(`/api/purchases?status=${statusFilter}`),
        fetch("/api/suppliers"),
        fetch("/api/products?status=active"),
      ]);
      if (poRes.ok) setOrders((await poRes.json()).items ?? []);
      if (sRes.ok) setSuppliers((await sRes.json()).items ?? []);
      if (pRes.ok) setProducts((await pRes.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;
  const lineTotal = (l: { quantityOrdered: string; unitCost: string; discount: string }) =>
    Math.max(0, (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0) - (Number(l.discount) || 0));
  const draftSubtotal = lines.reduce((s, l) => s + (l.productId ? lineTotal(l) : 0), 0);
  const draftTotal = draftSubtotal - (Number(discount) || 0) + (Number(freight) || 0);

  const resetCreateForm = () => {
    setSupplierId("");
    setPoStatus("approved");
    setFreight("0");
    setDiscount("0");
    setPaymentTerms("30 dias");
    setExpectedDelivery("");
    setNotes("");
    setLines([{ productId: "", quantityOrdered: "1", unitCost: "0", discount: "0" }]);
  };

  const submitOrder = async (printAfter: boolean) => {
    const validLines = lines.filter(
      (l) => l.productId && Number(l.quantityOrdered) > 0
    );
    if (!supplierId || validLines.length === 0) {
      toast({
        type: "warning",
        title: "Selecione fornecedor e ao menos um produto.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          status: poStatus,
          freight: Number(freight) || 0,
          discount: Number(discount) || 0,
          paymentTerms,
          expectedDelivery: expectedDelivery || null,
          notes: notes.trim() || null,
          items: validLines.map((l) => ({
            productId: l.productId,
            quantityOrdered: Number(l.quantityOrdered),
            unitCost: Number(l.unitCost),
            discount: Number(l.discount) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: `Pedido #${data.item.orderNumber} criado!`,
      });
      setCreateModal(false);
      resetCreateForm();
      await load();
      if (printAfter) await openPrint(data.item.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    void submitOrder(false);
  };

  const fetchDetail = async (id: string): Promise<PurchaseOrderDetail | null> => {
    const res = await fetch(`/api/purchases/${id}`);
    if (!res.ok) {
      toast({ type: "error", title: "Não foi possível abrir o pedido." });
      return null;
    }
    return (await res.json()) as PurchaseOrderDetail;
  };

  const openDetail = async (id: string) => {
    const d = await fetchDetail(id);
    if (d) {
      setConfirmCancel(false);
      setDetail(d);
    }
  };

  const toPrintDoc = (d: PurchaseOrderDetail): PurchaseOrderDocData => ({
    ...d.header,
    orderNumber: d.order.orderNumber,
    createdAt: d.order.createdAt,
    createdByName: d.order.createdByName,
    statusLabel: PO_STATUS[d.order.status]?.label ?? d.order.status,
    supplierName: d.order.supplierName || d.order.supplierLegalName,
    supplierDocument: d.order.supplierDocument,
    supplierContact: d.order.supplierContact,
    supplierPhone: d.order.supplierPhone,
    supplierAddress: d.order.supplierAddress,
    supplierCity: d.order.supplierCity,
    supplierState: d.order.supplierState,
    paymentTerms: d.order.paymentTerms,
    expectedDelivery: d.order.expectedDelivery,
    notes: d.order.notes,
    subtotal: d.order.subtotal,
    discount: d.order.discount,
    freight: d.order.freight,
    taxes: d.order.taxes,
    total: d.order.total,
    items: d.items.map((i) => ({
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      quantityOrdered: i.quantityOrdered,
      unitCost: i.unitCost,
      discount: i.discount,
      total: i.total,
    })),
  });

  const openPrint = async (id: string) => {
    const d = await fetchDetail(id);
    if (!d) return;
    setDetail(null);
    setPrintDoc(toPrintDoc(d));
  };

  const changeStatus = async (id: string, status: string, okMessage: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/purchases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: okMessage });
      setConfirmCancel(false);
      await load();
      await openDetail(id);
    } finally {
      setSubmitting(false);
    }
  };

  const openReceive = async (order: PurchaseOrderRow) => {
    const res = await fetch(`/api/purchases/${order.id}`);
    if (!res.ok) return;
    const data = await res.json();
    const initial: Record<string, number> = {};
    for (const it of data.items as PurchaseOrderItemDetail[]) {
      initial[it.id] = Math.max(0, it.quantityOrdered - it.quantityReceived);
    }
    setReceiveQtys(initial);
    setDetail(null);
    setReceiveModal({ order, items: data.items });
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveModal) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/purchases/${receiveModal.order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber,
          dueDate,
          generatePayable,
          items: Object.entries(receiveQtys)
            .filter(([, q]) => q > 0)
            .map(([itemId, quantityReceiving]) => ({
              itemId,
              quantityReceiving,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: "Recebimento concluído!",
        description: "Estoque atualizado e conta a pagar gerada.",
      });
      setReceiveModal(null);
      setInvoiceNumber("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const OPEN_STATUSES = ["draft", "pending_approval", "approved", "sent", "partially_received"];
  const openOrders = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const since = mountedAt - 30 * 86400 * 1000;
  const receivedRecent = orders.filter(
    (o) => o.status === "received" && new Date(o.createdAt).getTime() >= since
  );
  const sum = (rows: PurchaseOrderRow[]) => rows.reduce((s, r) => s + r.total, 0);

  const columns: ColumnDef<PurchaseOrderRow>[] = [
    {
      key: "orderNumber",
      header: "Pedido",
      sortable: true,
      sortValue: (r) => r.orderNumber,
      render: (r) => (
        <button
          type="button"
          onClick={() => openDetail(r.id)}
          className="font-mono font-bold text-sky-700 underline-offset-2 hover:underline"
        >
          #{r.orderNumber}
        </button>
      ),
    },
    {
      key: "supplierName",
      header: "Fornecedor",
      render: (r) => r.supplierName || r.supplierLegalName,
    },
    {
      key: "createdAt",
      header: "Emissão",
      render: (r) => formatDate(r.createdAt),
    },
    {
      key: "expectedDelivery",
      header: "Entrega prevista",
      render: (r) => (r.expectedDelivery ? formatDate(r.expectedDelivery) : "—"),
    },
    {
      key: "paymentTerms",
      header: "Condição",
      render: (r) => r.paymentTerms || "—",
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (r) => (
        <span className="font-mono font-semibold">
          {formatCurrency(r.total)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const st = PO_STATUS[r.status] ?? { label: r.status, tone: "neutral" as BadgeTone };
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
          <Button size="sm" variant="ghost" title="Ver pedido" onClick={() => openDetail(r.id)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" title="Imprimir pedido" onClick={() => openPrint(r.id)}>
            <Printer className="h-3.5 w-3.5" />
          </Button>
          {hasPermission("purchases.manage") &&
            r.status !== "received" &&
            r.status !== "cancelled" && (
              <Button size="sm" variant="outline" onClick={() => openReceive(r)}>
                <PackageCheck className="h-3.5 w-3.5 text-emerald-700" />
                Receber
              </Button>
            )}
        </div>
      ),
    },
  ];

  const d = detail;
  const canManage = hasPermission("purchases.manage");
  const detailOpen = d ? !["received", "cancelled"].includes(d.order.status) : false;
  const hasReceived = d ? d.items.some((i) => i.quantityReceived > 0) : false;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Compras</h1>
          <p className="text-xs text-slate-500">
            Pedidos de compra, recebimento parcial/total, entrada em estoque e
            contas a pagar
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Novo Pedido de Compra
          </Button>
        )}
      </div>

      <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Pedidos em aberto", value: String(openOrders.length), hint: formatCurrency(sum(openOrders)) + " a receber" },
          { label: "Recebidos em 30 dias", value: String(receivedRecent.length), hint: formatCurrency(sum(receivedRecent)) + " comprados" },
          { label: "Rascunhos", value: String(orders.filter((o) => o.status === "draft").length), hint: "ainda não enviados" },
        ].map((k) => (
          <div key={k.label} className="rounded border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{k.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
            <p className="text-[11px] text-slate-500">{k.hint}</p>
          </div>
        ))}
      </div>

      <div className="no-print">
        <DataTable
          data={orders}
          columns={columns}
          rowKey={(r) => r.id}
          loading={loading}
          toolbar={
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 w-48 text-xs"
            >
              <option value="all">Todos os status</option>
              <option value="draft">Rascunho</option>
              <option value="approved">Aprovado</option>
              <option value="sent">Enviado</option>
              <option value="partially_received">Recebido parcial</option>
              <option value="received">Recebido</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          }
        />
      </div>

      {/* Modal: Create PO */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Novo Pedido de Compra"
        subtitle="Escolha o fornecedor, monte os itens e confira o total antes de salvar."
        size="xl"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Fornecedor" required>
                  <Select
                    required
                    value={supplierId}
                    onChange={(e) => {
                      setSupplierId(e.target.value);
                      const sup = suppliers.find((s) => s.id === e.target.value);
                      if (sup?.paymentTerms) setPaymentTerms(sup.paymentTerms);
                    }}
                  >
                    <option value="">Selecione...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.tradeName || s.legalName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status inicial">
                  <Select value={poStatus} onChange={(e) => setPoStatus(e.target.value)}>
                    <option value="approved">Aprovado</option>
                    <option value="draft">Rascunho</option>
                    <option value="sent">Enviado ao fornecedor</option>
                  </Select>
                </Field>
              </div>

              {selectedSupplier && (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-900">{selectedSupplier.legalName}</p>
                  <p>
                    {selectedSupplier.document ? `CNPJ/CPF ${formatCnpjCpf(selectedSupplier.document)}` : "Sem CNPJ cadastrado"}
                    {selectedSupplier.city ? ` · ${selectedSupplier.city}${selectedSupplier.state ? "/" + selectedSupplier.state : ""}` : ""}
                  </p>
                  <p>
                    {selectedSupplier.contactName ? `Contato: ${selectedSupplier.contactName}` : "Sem contato cadastrado"}
                    {selectedSupplier.phone ? ` · ${selectedSupplier.phone}` : ""}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Itens do pedido</p>
                {lines.map((line, idx) => {
                  const patch = (p: Partial<(typeof lines)[number]>) =>
                    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...p } : l)));
                  return (
                    <div key={idx} className="rounded border border-slate-200 bg-slate-50 p-2">
                      <div className="grid grid-cols-12 items-end gap-2">
                        <div className="col-span-12 sm:col-span-5">
                          <Field label="Produto">
                            <Select
                              value={line.productId}
                              onChange={(e) => {
                                const prod = products.find((p) => p.id === e.target.value);
                                patch({
                                  productId: e.target.value,
                                  unitCost: prod?.costPrice ? String(prod.costPrice) : line.unitCost,
                                });
                              }}
                            >
                              <option value="">Selecione...</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} · {p.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Field label="Qtd">
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={line.quantityOrdered}
                              onChange={(e) => patch({ quantityOrdered: e.target.value })}
                            />
                          </Field>
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Field label="Custo unit.">
                            <Input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={line.unitCost}
                              onChange={(e) => patch({ unitCost: e.target.value })}
                            />
                          </Field>
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Field label="Desc. (R$)">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.discount}
                              onChange={(e) => patch({ discount: e.target.value })}
                            />
                          </Field>
                        </div>
                        <div className="col-span-12 flex items-center justify-between sm:col-span-1 sm:justify-end">
                          <span className="font-mono text-xs font-semibold text-slate-700 sm:hidden">
                            {formatCurrency(line.productId ? lineTotal(line) : 0)}
                          </span>
                          {lines.length > 1 && (
                            <button
                              type="button"
                              aria-label="Remover item"
                              onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                              className="mb-1 p-1 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 hidden text-right text-[11px] text-slate-500 sm:block">
                        Total do item:{" "}
                        <span className="font-mono font-semibold text-slate-800">
                          {formatCurrency(line.productId ? lineTotal(line) : 0)}
                        </span>
                      </p>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      { productId: "", quantityOrdered: "1", unitCost: "0", discount: "0" },
                    ])
                  }
                >
                  + Adicionar item
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Previsão de entrega">
                  <Input
                    type="date"
                    value={expectedDelivery}
                    onChange={(e) => setExpectedDelivery(e.target.value)}
                  />
                </Field>
                <Field label="Condição de pagamento">
                  <Input
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="Ex.: 28/56 dias"
                  />
                </Field>
              </div>
              <Field label="Observações do pedido">
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: entregar no período da manhã, doca 2"
                />
              </Field>
            </div>

            <aside className="h-fit space-y-3 rounded border border-slate-200 bg-white p-3 text-xs lg:sticky lg:top-0">
              <p className="font-semibold text-slate-900">Resumo do pedido</p>
              <div className="flex justify-between text-slate-600">
                <span>Itens</span>
                <span>{lines.filter((l) => l.productId).length}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(draftSubtotal)}</span>
              </div>
              <Field label="Desconto (R$)">
                <Input type="number" step="0.01" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Field label="Frete (R$)">
                <Input type="number" step="0.01" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </Field>
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <span className="font-semibold text-slate-900">Total</span>
                <span className="font-mono text-lg font-bold text-slate-900">{formatCurrency(draftTotal)}</span>
              </div>
            </aside>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="outline" loading={submitting} onClick={() => void submitOrder(true)}>
              <Printer className="h-3.5 w-3.5" />
              Salvar e imprimir
            </Button>
            <Button type="submit" loading={submitting}>
              Salvar Pedido
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Detalhe do pedido */}
      <Modal
        open={Boolean(d)}
        onClose={() => setDetail(null)}
        title={d ? `Pedido de compra #${d.order.orderNumber}` : ""}
        subtitle={d ? `Emitido em ${formatDateTime(d.order.createdAt)}${d.order.createdByName ? " por " + d.order.createdByName : ""}` : undefined}
        size="lg"
        footer={
          d && (
            <>
              {confirmCancel ? (
                <>
                  <span className="mr-auto self-center text-xs text-red-700">Cancelar este pedido?</span>
                  <Button variant="outline" onClick={() => setConfirmCancel(false)}>Voltar</Button>
                  <Button variant="danger" loading={submitting} onClick={() => changeStatus(d.order.id, "cancelled", "Pedido cancelado.")}>
                    Confirmar cancelamento
                  </Button>
                </>
              ) : (
                <>
                  {canManage && detailOpen && !hasReceived && (
                    <Button variant="ghost" className="mr-auto text-red-700" onClick={() => setConfirmCancel(true)}>
                      Cancelar pedido
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => openPrint(d.order.id)}>
                    <Printer className="h-3.5 w-3.5" />
                    Imprimir
                  </Button>
                  {canManage && d.order.status === "draft" && (
                    <Button variant="outline" loading={submitting} onClick={() => changeStatus(d.order.id, "approved", "Pedido aprovado.")}>
                      Aprovar
                    </Button>
                  )}
                  {canManage && d.order.status === "approved" && (
                    <Button variant="outline" loading={submitting} onClick={() => changeStatus(d.order.id, "sent", "Pedido marcado como enviado.")}>
                      Marcar como enviado
                    </Button>
                  )}
                  {canManage && detailOpen && (
                    <Button
                      onClick={() =>
                        openReceive(
                          orders.find((o) => o.id === d.order.id) ?? ({
                            id: d.order.id,
                            orderNumber: d.order.orderNumber,
                            supplierName: d.order.supplierName,
                            supplierLegalName: d.order.supplierLegalName,
                            status: d.order.status,
                            total: d.order.total,
                            paymentTerms: d.order.paymentTerms,
                            expectedDelivery: d.order.expectedDelivery,
                            createdAt: d.order.createdAt,
                          } as PurchaseOrderRow)
                        )
                      }
                    >
                      <PackageCheck className="h-3.5 w-3.5" />
                      Receber mercadorias
                    </Button>
                  )}
                </>
              )}
            </>
          )
        }
      >
        {d && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded border border-slate-200 p-3 sm:col-span-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Fornecedor</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{d.order.supplierName || d.order.supplierLegalName}</p>
                <p className="text-slate-600">{d.order.supplierLegalName}</p>
                <p className="text-slate-600">
                  {d.order.supplierDocument ? `CNPJ/CPF ${formatCnpjCpf(d.order.supplierDocument)}` : "Sem CNPJ cadastrado"}
                </p>
                {d.order.supplierAddress && (
                  <p className="text-slate-600">
                    {d.order.supplierAddress}
                    {d.order.supplierCity ? ` · ${d.order.supplierCity}${d.order.supplierState ? "/" + d.order.supplierState : ""}` : ""}
                  </p>
                )}
                <p className="text-slate-600">
                  {[d.order.supplierContact, d.order.supplierPhone, d.order.supplierEmail].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                </p>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Situação</p>
                <div className="mt-1">
                  <Badge tone={(PO_STATUS[d.order.status] ?? { tone: "neutral" as BadgeTone }).tone}>
                    {PO_STATUS[d.order.status]?.label ?? d.order.status}
                  </Badge>
                </div>
                <p className="mt-2 text-slate-600">Pagamento: {d.order.paymentTerms || "A combinar"}</p>
                <p className="text-slate-600">
                  Entrega: {d.order.expectedDelivery ? formatDate(d.order.expectedDelivery) : "A combinar"}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full min-w-[560px] text-left">
                <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Pedido</th>
                    <th className="px-3 py-2 text-right">Recebido</th>
                    <th className="px-3 py-2 text-right">Pendente</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it) => {
                    const pending = Math.max(0, it.quantityOrdered - it.quantityReceived);
                    return (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-slate-900">{it.productName}</p>
                          <p className="font-mono text-[11px] text-slate-500">{it.sku}</p>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{it.quantityOrdered} {it.unit}</td>
                        <td className="px-3 py-2 text-right font-mono">{it.quantityReceived}</td>
                        <td className={`px-3 py-2 text-right font-mono ${pending > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}`}>{pending}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(it.unitCost)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(it.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                {d.order.notes && (
                  <div className="rounded border border-slate-200 p-3">
                    <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Observações</p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-700">{d.order.notes}</p>
                  </div>
                )}
                <div className="rounded border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Recebimentos</p>
                  {d.receipts.length === 0 ? (
                    <p className="mt-1 text-slate-500">Nenhuma mercadoria recebida ainda.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {d.receipts.map((r) => (
                        <li key={r.id} className="text-slate-700">
                          {formatDateTime(r.receivedAt)}
                          {r.invoiceNumber ? ` · NF ${r.invoiceNumber}` : ""}
                          {r.receivedByName ? ` · ${r.receivedByName}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="space-y-1 rounded border border-slate-200 p-3">
                <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">{formatCurrency(d.order.subtotal)}</span></div>
                {d.order.discount > 0 && <div className="flex justify-between text-slate-600"><span>Descontos</span><span className="font-mono">-{formatCurrency(d.order.discount)}</span></div>}
                {d.order.freight > 0 && <div className="flex justify-between text-slate-600"><span>Frete</span><span className="font-mono">+{formatCurrency(d.order.freight)}</span></div>}
                {d.order.taxes > 0 && <div className="flex justify-between text-slate-600"><span>Impostos</span><span className="font-mono">+{formatCurrency(d.order.taxes)}</span></div>}
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-900">Total do pedido</span>
                  <span className="font-mono text-lg font-bold text-slate-900">{formatCurrency(d.order.total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Impressão no estilo do comprovante de venda */}
      <Modal
        open={Boolean(printDoc)}
        onClose={() => setPrintDoc(null)}
        title="Pedido de compra"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPrintDoc(null)}>
              Fechar
            </Button>
            <Button variant="warning" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              Imprimir / salvar PDF
            </Button>
          </>
        }
      >
        {printDoc && <PurchaseOrderDocument data={printDoc} />}
      </Modal>

      {/* Modal: Receive PO */}
      <Modal
        open={Boolean(receiveModal)}
        onClose={() => setReceiveModal(null)}
        title={`Receber Mercadorias — PC #${receiveModal?.order.orderNumber ?? ""}`}
        size="lg"
      >
        {receiveModal && (
          <form onSubmit={handleReceive} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Número da Nota Fiscal">
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Ex.: NF-001234"
                />
              </Field>
              <Field label="Vencimento da conta a pagar">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              {receiveModal.items.map((it) => {
                const pending = Math.max(
                  0,
                  it.quantityOrdered - it.quantityReceived
                );
                return (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-3 rounded border border-slate-200 p-2.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {it.productName}
                      </p>
                      <p className="text-slate-500">
                        Pedido: {it.quantityOrdered} · Já recebido:{" "}
                        {it.quantityReceived} · Pendente: {pending} {it.unit}
                      </p>
                    </div>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      max={pending}
                      className="w-28 text-right font-mono"
                      value={receiveQtys[it.id] ?? 0}
                      onChange={(e) =>
                        setReceiveQtys((prev) => ({
                          ...prev,
                          [it.id]: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={generatePayable}
                onChange={(e) => setGeneratePayable(e.target.checked)}
              />
              Gerar título em Contas a Pagar automaticamente
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReceiveModal(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={submitting}>
                Confirmar Recebimento
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
