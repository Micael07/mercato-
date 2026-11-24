"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PackageCheck, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Badge,
  BadgeTone,
  Button,
  Field,
  Input,
  Modal,
  Select,
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
  const [suppliers, setSuppliers] = useState<
    Array<{ id: string; tradeName: string | null; legalName: string }>
  >([]);
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
  const [lines, setLines] = useState<
    Array<{ productId: string; quantityOrdered: string; unitCost: string }>
  >([{ productId: "", quantityOrdered: "10", unitCost: "0" }]);

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

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
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
          items: validLines.map((l) => ({
            productId: l.productId,
            quantityOrdered: Number(l.quantityOrdered),
            unitCost: Number(l.unitCost),
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
      load();
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

  const columns: ColumnDef<PurchaseOrderRow>[] = [
    {
      key: "orderNumber",
      header: "Pedido",
      sortable: true,
      sortValue: (r) => r.orderNumber,
      render: (r) => (
        <span className="font-mono font-bold">#{r.orderNumber}</span>
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
      render: (r) =>
        hasPermission("purchases.manage") &&
        r.status !== "received" &&
        r.status !== "cancelled" ? (
          <Button size="sm" variant="outline" onClick={() => openReceive(r)}>
            <PackageCheck className="h-3.5 w-3.5 text-emerald-700" />
            Receber
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Compras</h1>
          <p className="text-xs text-slate-500">
            Pedidos de compra, recebimento parcial/total, entrada em estoque e
            contas a pagar
          </p>
        </div>
        {hasPermission("purchases.manage") && (
          <Button onClick={() => setCreateModal(true)}>
            <Plus className="h-4 w-4" />
            Novo Pedido de Compra
          </Button>
        )}
      </div>

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
            <option value="partially_received">Recebido parcial</option>
            <option value="received">Recebido</option>
            <option value="cancelled">Cancelado</option>
          </Select>
        }
      />

      {/* Modal: Create PO */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Novo Pedido de Compra"
        size="lg"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Fornecedor" required>
                <Select
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.tradeName || s.legalName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Status inicial">
              <Select
                value={poStatus}
                onChange={(e) => setPoStatus(e.target.value)}
              >
                <option value="approved">Aprovado</option>
                <option value="draft">Rascunho</option>
                <option value="sent">Enviado ao fornecedor</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Itens do pedido</p>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-end gap-2 rounded border border-slate-200 bg-slate-50 p-2"
              >
                <div className="col-span-6">
                  <Field label="Produto">
                    <Select
                      value={line.productId}
                      onChange={(e) => {
                        const prod = products.find((p) => p.id === e.target.value);
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx
                              ? {
                                  ...l,
                                  productId: e.target.value,
                                  unitCost: prod?.costPrice
                                    ? String(prod.costPrice)
                                    : l.unitCost,
                                }
                              : l
                          )
                        );
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
                <div className="col-span-2">
                  <Field label="Qtd">
                    <Input
                      type="number"
                      step="0.001"
                      value={line.quantityOrdered}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx
                              ? { ...l, quantityOrdered: e.target.value }
                              : l
                          )
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-3">
                  <Field label="Custo Unit. (R$)">
                    <Input
                      type="number"
                      step="0.0001"
                      value={line.unitCost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, unitCost: e.target.value } : l
                          )
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-1 flex justify-end">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="mb-1 p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { productId: "", quantityOrdered: "1", unitCost: "0" },
                ])
              }
            >
              + Adicionar item
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Frete (R$)">
              <Input
                type="number"
                step="0.01"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
              />
            </Field>
            <Field label="Desconto (R$)">
              <Input
                type="number"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Cond. Pagamento">
              <Input
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Salvar Pedido
            </Button>
          </div>
        </form>
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
