"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Plus } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Panel,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface InventoryRow {
  id: string;
  code: string;
  description: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
}

interface InventoryDetailItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  systemQuantity: number;
  countedQuantity: number | null;
  recountQuantity: number | null;
  divergence: number;
  adjusted: boolean;
}

export default function InventarioPage() {
  const { session } = useSession();
  const { toast } = useToast();

  const [items, setItems] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModal, setCreateModal] = useState(false);
  const [description, setDescription] = useState("");
  const [selectedInv, setSelectedInv] = useState<InventoryRow | null>(null);
  const [invItems, setInvItems] = useState<InventoryDetailItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventories");
      if (res.ok) setItems((await res.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const openCountSheet = async (inv: InventoryRow) => {
    const res = await fetch(`/api/inventories/${inv.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setSelectedInv(data.inventory);
    setInvItems(data.items ?? []);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Inventário aberto para contagem!" });
      setCreateModal(false);
      setDescription("");
      load();
      openCountSheet(data.item);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCounts = async () => {
    if (!selectedInv) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/inventories/${selectedInv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counts: invItems.map((i) => ({
            itemId: i.id,
            countedQuantity: i.countedQuantity,
            recountQuantity: i.recountQuantity,
          })),
        }),
      });
      if (res.ok) {
        toast({ type: "success", title: "Contagens salvas!" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedInv) return;
    setSubmitting(true);
    try {
      await fetch(`/api/inventories/${selectedInv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counts: invItems.map((i) => ({
            itemId: i.id,
            countedQuantity: i.countedQuantity,
            recountQuantity: i.recountQuantity,
          })),
        }),
      });

      const res = await fetch(`/api/inventories/${selectedInv.id}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: "Inventário aprovado e saldos ajustados!",
      });
      setSelectedInv(null);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<InventoryRow>[] = [
    {
      key: "code",
      header: "Código",
      render: (r) => <span className="font-mono font-semibold">{r.code}</span>,
    },
    {
      key: "description",
      header: "Descrição",
      render: (r) => r.description,
    },
    {
      key: "openedByName",
      header: "Responsável",
      render: (r) => r.openedByName || "—",
    },
    {
      key: "openedAt",
      header: "Abertura",
      render: (r) => formatDateTime(r.openedAt),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={r.status === "approved" ? "success" : "warning"}>
          {r.status === "approved" ? "Aprovado" : "Em contagem"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Ação",
      align: "right",
      hideable: false,
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => openCountSheet(r)}>
          <ClipboardCheck className="h-3.5 w-3.5" />
          {r.status === "approved" ? "Ver diferenças" : "Contar / Aprovar"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            Inventário de Estoque
          </h1>
          <p className="text-xs text-slate-500">
            Contagem física, recontagem, apuração de divergências e ajuste automático
          </p>
        </div>
        <Button onClick={() => setCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Novo Inventário
        </Button>
      </div>

      {selectedInv && (
        <Panel
          title={`${selectedInv.code} — ${selectedInv.description}`}
          subtitle={
            selectedInv.status === "approved"
              ? "Inventário aprovado e consolidado no estoque"
              : "Informe as quantidades contadas e aprove para ajustar o estoque"
          }
          actions={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedInv(null)}
              >
                Fechar ficha
              </Button>
              {selectedInv.status !== "approved" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveCounts}
                    loading={submitting}
                  >
                    Salvar contagem
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    loading={submitting}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Aprovar e Ajustar Estoque
                  </Button>
                </>
              )}
            </div>
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Saldo Sistema</th>
                  <th className="px-3 py-2 text-right">1ª Contagem</th>
                  <th className="px-3 py-2 text-right">Recontagem</th>
                  <th className="px-3 py-2 text-right">Divergência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invItems.map((it) => {
                  const finalCount =
                    it.recountQuantity !== null
                      ? it.recountQuantity
                      : it.countedQuantity;
                  const div =
                    finalCount !== null
                      ? finalCount - it.systemQuantity
                      : it.divergence;
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-2 font-mono">{it.sku}</td>
                      <td className="px-3 py-2 font-medium">{it.productName}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {it.systemQuantity} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          disabled={selectedInv.status === "approved"}
                          value={it.countedQuantity ?? ""}
                          onChange={(e) => {
                            const val =
                              e.target.value === ""
                                ? null
                                : Number(e.target.value);
                            setInvItems((prev) =>
                              prev.map((row) =>
                                row.id === it.id
                                  ? { ...row, countedQuantity: val }
                                  : row
                              )
                            );
                          }}
                          className="h-7 w-24 rounded border border-slate-300 px-2 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          disabled={selectedInv.status === "approved"}
                          value={it.recountQuantity ?? ""}
                          onChange={(e) => {
                            const val =
                              e.target.value === ""
                                ? null
                                : Number(e.target.value);
                            setInvItems((prev) =>
                              prev.map((row) =>
                                row.id === it.id
                                  ? { ...row, recountQuantity: val }
                                  : row
                              )
                            );
                          }}
                          className="h-7 w-24 rounded border border-slate-300 px-2 text-right font-mono text-xs"
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-bold ${
                          div < 0
                            ? "text-red-700"
                            : div > 0
                            ? "text-emerald-700"
                            : "text-slate-400"
                        }`}
                      >
                        {finalCount !== null
                          ? `${div > 0 ? "+" : ""}${div.toFixed(3)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <DataTable
        data={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
      />

      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Abrir Novo Inventário"
        size="sm"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Field
            label="Descrição da contagem"
            required
            hint="Todos os produtos ativos com controle de estoque serão carregados com o saldo atual."
          >
            <Input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Balanço geral mensal"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Iniciar Contagem
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
