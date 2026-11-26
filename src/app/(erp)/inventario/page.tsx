"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Plus, Printer, Search, Trash2 } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Panel,
  Select,
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
  totalItems?: number;
  countedItems?: number;
}

interface InventoryDetailItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  costPrice: number;
  categoryName: string;
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
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "divergent">("all");
  const [approveModal, setApproveModal] = useState(false);
  const [ignoreUncounted, setIgnoreUncounted] = useState(false);
  const [toDelete, setToDelete] = useState<InventoryRow | null>(null);

  const finalOf = (i: InventoryDetailItem) =>
    i.recountQuantity !== null ? i.recountQuantity : i.countedQuantity;
  const divOf = (i: InventoryDetailItem) => {
    const f = finalOf(i);
    return f === null ? null : Number((f - i.systemQuantity).toFixed(3));
  };
  const summary = (() => {
    let counted = 0, surplus = 0, shortage = 0, divergent = 0;
    for (const i of invItems) {
      const d = divOf(i);
      if (d === null) continue;
      counted++;
      if (d !== 0) divergent++;
      if (d > 0) surplus += d * i.costPrice;
      if (d < 0) shortage += -d * i.costPrice;
    }
    return { counted, pending: invItems.length - counted, divergent, surplus, shortage };
  })();

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
    void fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setCategories(d.items ?? []))
      .catch(() => {});
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
    setSearch("");
    setFilter("all");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, categoryId: categoryId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Inventário aberto para contagem!" });
      setCreateModal(false);
      setDescription("");
      setCategoryId("");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoreUncounted }),
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
      setApproveModal(false);
      setIgnoreUncounted(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/inventories/${toDelete.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: "error", title: data.error ?? "Não foi possível excluir." });
        return;
      }
      toast({ type: "success", title: "Inventário excluído." });
      if (selectedInv?.id === toDelete.id) setSelectedInv(null);
      setToDelete(null);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const printSheet = () => {
    if (!selectedInv) return;
    const esc = (v: string) =>
      v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const rows = invItems
      .map(
        (i) =>
          `<tr><td>${esc(i.sku)}</td><td>${esc(i.productName)}</td><td>${esc(i.categoryName)}</td><td>${esc(i.unit)}</td><td class="b"></td><td class="b"></td></tr>`
      )
      .join("");
    const w = window.open("", "_blank");
    if (!w) {
      toast({ type: "error", title: "Permita pop-ups para imprimir a folha." });
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(selectedInv.code)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:16px;margin:0}p{margin:4px 0 14px;color:#555}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee;font-size:11px;text-transform:uppercase}
td.b{width:90px}.sig{margin-top:40px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:11px}
@page{size:A4;margin:12mm}</style></head><body>
<h1>Folha de contagem — ${esc(selectedInv.code)}</h1><p>${esc(selectedInv.description)} · gerada em ${esc(formatDateTime(new Date()))} · saldo do sistema oculto (contagem cega)</p>
<table><thead><tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Contagem</th><th>Recontagem</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div>Contado por</div><div>Conferido por</div></div>
<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  };

  const visibleItems = invItems.filter((i) => {
    const q = search.trim().toLowerCase();
    if (q && !`${i.sku} ${i.productName} ${i.categoryName}`.toLowerCase().includes(q)) return false;
    if (filter === "pending") return finalOf(i) === null;
    if (filter === "divergent") {
      const d = divOf(i);
      return d !== null && d !== 0;
    }
    return true;
  });

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
        <Badge tone={r.status === "approved" ? "success" : r.status === "cancelled" ? "neutral" : "warning"}>
          {r.status === "approved" ? "Aprovado" : r.status === "cancelled" ? "Cancelado" : "Em contagem"}
        </Badge>
      ),
    },
    {
      key: "progress",
      header: "Contados",
      render: (r) =>
        r.totalItems ? `${r.countedItems ?? 0} / ${r.totalItems}` : "—",
    },
    {
      key: "actions",
      header: "Ação",
      align: "right",
      hideable: false,
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={() => openCountSheet(r)}>
            <ClipboardCheck className="h-3.5 w-3.5" />
            {r.status === "counting" ? "Contar / Aprovar" : "Ver diferenças"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setToDelete(r)} aria-label="Excluir inventário" title="Excluir inventário">
            <Trash2 className="h-3.5 w-3.5 text-red-600" />
          </Button>
        </div>
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
              <Button size="sm" variant="outline" onClick={printSheet}>
                <Printer className="h-3.5 w-3.5" />
                Folha de contagem
              </Button>
              {selectedInv.status === "counting" && (
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
                    onClick={() => setApproveModal(true)}
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
          <div className="space-y-2 border-b border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="min-w-[180px] flex-1">
                <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                  <span>{summary.counted} de {invItems.length} contados</span>
                  <span>{invItems.length ? Math.round((summary.counted / invItems.length) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full bg-sky-600"
                    style={{ width: `${invItems.length ? (summary.counted / invItems.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className="text-slate-500">Divergências: <b className="text-slate-800">{summary.divergent}</b></span>
              <span className="text-emerald-700">Sobras: <b>{formatCurrency(summary.surplus)}</b></span>
              <span className="text-red-700">Faltas: <b>{formatCurrency(summary.shortage)}</b></span>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  className="pl-8"
                  placeholder="Buscar por SKU, produto ou categoria"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-48">
                <option value="all">Todos os itens</option>
                <option value="pending">Somente não contados</option>
                <option value="divergent">Somente com divergência</option>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2 text-right">Saldo Sistema</th>
                  <th className="px-3 py-2 text-right">1ª Contagem</th>
                  <th className="px-3 py-2 text-right">Recontagem</th>
                  <th className="px-3 py-2 text-right">Divergência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Nenhum item neste filtro.
                    </td>
                  </tr>
                )}
                {visibleItems.map((it) => {
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
                      <td className="px-3 py-2 text-slate-500">{it.categoryName}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {it.systemQuantity} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          disabled={selectedInv.status !== "counting"}
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
                          disabled={selectedInv.status !== "counting"}
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
          <Field label="Categoria" hint="Opcional: contar só uma categoria (ex.: um corredor ou setor).">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
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

      <Modal
        open={approveModal}
        onClose={() => setApproveModal(false)}
        title="Aprovar inventário e ajustar estoque"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setApproveModal(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              onClick={handleApprove}
              loading={submitting}
              disabled={summary.pending > 0 && !ignoreUncounted}
            >
              Aprovar e ajustar
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs text-slate-600">
          <p>
            {summary.divergent} item(ns) com divergência: sobras de <b className="text-emerald-700">{formatCurrency(summary.surplus)}</b> e
            faltas de <b className="text-red-700">{formatCurrency(summary.shortage)}</b> (a preço de custo). O saldo será ajustado e a
            operação fica registrada no histórico do estoque.
          </p>
          {summary.pending > 0 && (
            <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ignoreUncounted}
                onChange={(e) => setIgnoreUncounted(e.target.checked)}
              />
              <span>
                Ainda há {summary.pending} item(ns) sem contagem. Marque para aprovar mesmo assim — esses itens
                ficam com o saldo atual, sem ajuste.
              </span>
            </label>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        loading={submitting}
        danger
        title="Excluir inventário"
        confirmLabel="Excluir"
        description={
          toDelete?.status === "approved"
            ? `O inventário ${toDelete.code} já foi aprovado: excluir remove só o registro da contagem. Os ajustes já feitos no estoque NÃO são desfeitos e continuam no histórico de movimentações.`
            : `Excluir o inventário ${toDelete?.code ?? ""}? A contagem lançada será descartada e o estoque não será alterado.`
        }
      />
    </div>
  );
}
