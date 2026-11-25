"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Download } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { downloadCsv, formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface StockMovementRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  type: string;
  quantity: number;
  previousBalance: number;
  newBalance: number;
  originDocument: string | null;
  justification: string | null;
  userName: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  purchase_in: "Entrada (Compra)",
  manual_in: "Entrada Manual",
  sale_out: "Saída (Venda)",
  manual_out: "Saída Manual",
  return_in: "Devolução",
  adjustment_pos: "Ajuste (+)",
  adjustment_neg: "Ajuste (-)",
  transfer: "Transferência",
  inventory: "Inventário",
  loss_expired: "Perda (vencimento)",
  loss_breakage: "Perda (quebra/avaria)",
  loss_theft: "Perda (extravio/furto)",
};

export default function EstoquePage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [products, setProducts] = useState<
    Array<{ id: string; sku: string; name: string; currentStock: number; unit: string }>
  >([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    productId: "",
    type: "manual_in",
    quantity: "1",
    justification: "",
    expiryDate: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, pRes] = await Promise.all([
        fetch(`/api/stock?type=${typeFilter}`),
        fetch("/api/products?status=active"),
      ]);
      if (mRes.ok) setMovements((await mRes.json()).items ?? []);
      if (pRes.ok) setProducts((await pRes.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: "Movimentação registrada!",
        description: `Novo saldo: ${data.newBalance}`,
      });
      setModalOpen(false);
      setForm({ productId: "", type: "manual_in", quantity: "1", justification: "", expiryDate: "" });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<StockMovementRow>[] = [
    {
      key: "createdAt",
      header: "Data / Hora",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => formatDateTime(r.createdAt),
    },
    {
      key: "productName",
      header: "Produto",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.productName}</p>
          <p className="font-mono text-[10px] text-slate-400">{r.sku}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      render: (r) => {
        const isOut = r.type.endsWith("_out") || r.type.endsWith("_neg");
        return (
          <Badge tone={isOut ? "warning" : "success"}>
            {TYPE_LABELS[r.type] ?? r.type}
          </Badge>
        );
      },
    },
    {
      key: "quantity",
      header: "Qtd",
      align: "right",
      render: (r) => (
        <span className="font-mono font-bold">
          {r.quantity} {r.unit}
        </span>
      ),
    },
    {
      key: "balances",
      header: "Saldo Ant. → Novo",
      align: "right",
      render: (r) => (
        <span className="font-mono text-slate-600">
          {r.previousBalance} → <strong className="text-slate-900">{r.newBalance}</strong>
        </span>
      ),
    },
    {
      key: "originDocument",
      header: "Documento / Justificativa",
      render: (r) => (
        <div className="max-w-xs">
          {r.originDocument && (
            <p className="font-mono text-[10px] font-semibold text-slate-700">
              {r.originDocument}
            </p>
          )}
          <p className="truncate text-slate-500">{r.justification || "—"}</p>
        </div>
      ),
    },
    {
      key: "userName",
      header: "Usuário",
      render: (r) => r.userName || "—",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            Movimentação de Estoque
          </h1>
          <p className="text-xs text-slate-500">
            Registro transacional imutável de entradas, saídas, ajustes e vendas
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "movimentacoes-estoque",
                ["Data", "SKU", "Produto", "Tipo", "Qtd", "Anterior", "Novo", "Justificativa"],
                movements.map((m) => [
                  formatDateTime(m.createdAt),
                  m.sku,
                  m.productName,
                  TYPE_LABELS[m.type] ?? m.type,
                  m.quantity,
                  m.previousBalance,
                  m.newBalance,
                  m.justification ?? "",
                ])
              )
            }
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          {hasPermission("stock.move") && (
            <Button onClick={() => setModalOpen(true)}>
              <ArrowLeftRight className="h-4 w-4" />
              Movimentar Estoque
            </Button>
          )}
        </div>
      </div>

      <DataTable
        data={movements}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        toolbar={
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 w-52 text-xs"
          >
            <option value="all">Todos os tipos</option>
            <option value="purchase_in">Entrada por compra</option>
            <option value="manual_in">Entrada manual</option>
            <option value="sale_out">Saída por venda</option>
            <option value="manual_out">Saída manual</option>
            <option value="return_in">Devolução</option>
            <option value="adjustment_pos">Ajuste positivo</option>
            <option value="adjustment_neg">Ajuste negativo</option>
            <option value="inventory">Inventário</option>
            <option value="loss_expired">Perda por vencimento</option>
            <option value="loss_breakage">Quebra / avaria</option>
            <option value="loss_theft">Extravio / furto</option>
          </Select>
        }
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Movimentação Manual / Ajuste de Estoque"
        size="md"
      >
        <form onSubmit={handleMove} className="space-y-4">
          <Field label="Produto" required>
            <Select
              required
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}
            >
              <option value="">Selecione um produto...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} (Saldo: {p.currentStock} {p.unit})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de movimentação" required>
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="manual_in">Entrada manual (+)</option>
                <option value="manual_out">Saída manual (-)</option>
                <option value="adjustment_pos">Ajuste positivo (+)</option>
                <option value="adjustment_neg">Ajuste negativo (-)</option>
                <option value="loss_expired">Perda por vencimento (-)</option>
                <option value="loss_breakage">Quebra / avaria (-)</option>
                <option value="loss_theft">Extravio / furto (-)</option>
              </Select>
            </Field>
            <Field label="Quantidade" required>
              <Input
                type="number"
                step="0.001"
                min="0.001"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Field>
          </div>
          {(form.type === "manual_in" || form.type === "adjustment_pos") && (
            <Field label="Validade do lote que entrou (opcional)" hint="Atualiza a validade mais próxima do produto, usada no relatório de vencimentos.">
              <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
          )}
          <Field label="Justificativa obrigatória" required>
            <Textarea
              required
              rows={3}
              value={form.justification}
              onChange={(e) =>
                setForm({ ...form, justification: e.target.value })
              }
              placeholder="Ex.: Avaria, bonificação, acerto de conferência..."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Registrar Movimentação
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
