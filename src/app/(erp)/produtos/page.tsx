"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Upload,
  Download,
  Edit3,
  Power,
  History,
  FolderPlus,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import {
  downloadCsv,
  downloadExcelXml,
  formatCurrency,
  formatDateTime,
} from "@/lib/format";
import {
  Badge,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface ProductRow {
  id: string;
  internalCode: string;
  sku: string;
  barcode: string | null;
  name: string;
  shortName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  unit: string;
  costPrice: number | null;
  salePrice: number;
  marginPercent: number | null;
  minStock: number;
  maxStock: number;
  currentStock: number;
  location: string | null;
  mainSupplierId: string | null;
  supplierName: string | null;
  allowFractional: boolean;
  trackStock: boolean;
  status: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

const EMPTY_FORM = {
  id: "",
  name: "",
  shortName: "",
  sku: "",
  barcode: "",
  categoryId: "",
  brand: "",
  unit: "UN",
  costPrice: "0",
  salePrice: "0",
  minStock: "5",
  maxStock: "50",
  initialStock: "0",
  location: "",
  allowFractional: false,
  trackStock: true,
  priceReason: "",
};

export default function ProdutosPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [items, setItems] = useState<ProductRow[]>([]);
  const [canViewCost, setCanViewCost] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const [formDrawer, setFormDrawer] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [historyDrawer, setHistoryDrawer] = useState<{
    product: ProductRow;
    priceHistory: Array<{
      id: string;
      previousCost: string;
      newCost: string;
      previousPrice: string;
      newPrice: string;
      reason: string;
      changedByName: string | null;
      createdAt: string;
    }>;
    movements: Array<{
      id: string;
      type: string;
      quantity: string;
      previousBalance: string;
      newBalance: string;
      originDocument: string | null;
      createdAt: string;
    }>;
  } | null>(null);

  const [catModal, setCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [importModal, setImportModal] = useState(false);
  const [csvText, setCsvText] = useState(
    "sku;barcode;name;unit;costPrice;salePrice;minStock;stock\nEX-001;7890001112223;Produto Exemplo;UN;10.00;24.90;5;20"
  );
  const [inactivateTarget, setInactivateTarget] = useState<ProductRow | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (categoryFilter) qs.set("categoryId", categoryFilter);
      if (stockFilter) qs.set("stockFilter", stockFilter);
      if (statusFilter) qs.set("status", statusFilter);

      const [pRes, cRes] = await Promise.all([
        fetch(`/api/products?${qs.toString()}`),
        fetch("/api/categories"),
      ]);
      if (pRes.ok) {
        const data = await pRes.json();
        setItems(data.items ?? []);
        setCanViewCost(Boolean(data.canViewCost));
      }
      if (cRes.ok) {
        setCategories((await cRes.json()).items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [q, categoryFilter, stockFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setFormDrawer(true);
  };

  const openEdit = (p: ProductRow) => {
    setForm({
      id: p.id,
      name: p.name,
      shortName: p.shortName ?? "",
      sku: p.sku,
      barcode: p.barcode ?? "",
      categoryId: p.categoryId ?? "",
      brand: p.brand ?? "",
      unit: p.unit,
      costPrice: p.costPrice !== null ? String(p.costPrice) : "0",
      salePrice: String(p.salePrice),
      minStock: String(p.minStock),
      maxStock: String(p.maxStock),
      initialStock: "0",
      location: p.location ?? "",
      allowFractional: p.allowFractional,
      trackStock: p.trackStock,
      priceReason: "",
    });
    setFormDrawer(true);
  };

  const openHistory = async (p: ProductRow) => {
    const res = await fetch(`/api/products/${p.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setHistoryDrawer({
      product: p,
      priceHistory: data.priceHistory ?? [],
      movements: data.movements ?? [],
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch(
        isEdit ? `/api/products/${form.id}` : "/api/products",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            costPrice: Number(form.costPrice) || 0,
            salePrice: Number(form.salePrice) || 0,
            minStock: Number(form.minStock) || 0,
            maxStock: Number(form.maxStock) || 0,
            initialStock: Number(form.initialStock) || 0,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error || "Erro ao salvar produto" });
        return;
      }
      toast({
        type: "success",
        title: isEdit ? "Produto atualizado!" : "Produto cadastrado!",
      });
      setFormDrawer(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleInactivate = async () => {
    if (!inactivateTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${inactivateTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast({ type: "success", title: "Produto inativado." });
        setInactivateTarget(null);
        load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCatName }),
    });
    if (res.ok) {
      toast({ type: "success", title: "Categoria criada!" });
      setNewCatName("");
      setCatModal(false);
      load();
    }
  };

  const handleImportCsv = async () => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      toast({ type: "warning", title: "Informe cabeçalho e ao menos 1 linha." });
      return;
    }
    const headers = lines[0].split(";").map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(";");
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (cols[i] ?? "").trim();
      });
      return obj;
    });
    setSubmitting(true);
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          type: "success",
          title: `${data.imported} produto(s) importado(s)`,
          description:
            data.errors?.length > 0 ? `${data.errors.length} linha(s) ignorada(s)` : undefined,
        });
        setImportModal(false);
        load();
      } else {
        toast({ type: "error", title: data.error });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const computedMargin =
    Number(form.costPrice) > 0
      ? ((Number(form.salePrice) - Number(form.costPrice)) /
          Number(form.costPrice)) *
        100
      : 0;

  const columns: ColumnDef<ProductRow>[] = [
    {
      key: "sku",
      header: "SKU / Cód. Barras",
      sortable: true,
      sortValue: (r) => r.sku,
      render: (r) => (
        <div>
          <p className="font-mono font-semibold text-slate-900">{r.sku}</p>
          {r.barcode && (
            <p className="font-mono text-[10px] text-slate-400">{r.barcode}</p>
          )}
        </div>
      ),
    },
    {
      key: "name",
      header: "Descrição",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.name}</p>
          <p className="text-[11px] text-slate-500">
            {r.categoryName || "Sem categoria"}
            {r.brand ? ` · ${r.brand}` : ""}
          </p>
        </div>
      ),
    },
    ...(canViewCost
      ? [
          {
            key: "costPrice",
            header: "Custo",
            align: "right" as const,
            sortable: true,
            sortValue: (r: ProductRow) => r.costPrice ?? 0,
            render: (r: ProductRow) => (
              <span className="font-mono text-slate-600">
                {formatCurrency(r.costPrice)}
              </span>
            ),
          },
          {
            key: "marginPercent",
            header: "Margem",
            align: "right" as const,
            render: (r: ProductRow) => (
              <span className="font-mono text-slate-600">
                {r.marginPercent !== null ? `${r.marginPercent.toFixed(1)}%` : "—"}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "salePrice",
      header: "Preço Venda",
      align: "right",
      sortable: true,
      sortValue: (r) => r.salePrice,
      render: (r) => (
        <span className="font-mono font-bold text-[#0f4c5c]">
          {formatCurrency(r.salePrice)}
        </span>
      ),
    },
    {
      key: "currentStock",
      header: "Estoque",
      align: "right",
      sortable: true,
      sortValue: (r) => r.currentStock,
      render: (r) => {
        if (!r.trackStock) return <Badge tone="neutral">Livre</Badge>;
        const zero = r.currentStock <= 0;
        const low = r.currentStock > 0 && r.currentStock <= r.minStock;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <span className="font-mono font-semibold">
              {r.currentStock} {r.unit}
            </span>
            {zero && <Badge tone="danger">Zerado</Badge>}
            {low && <Badge tone="warning">Baixo</Badge>}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Situação",
      render: (r) => (
        <Badge tone={r.status === "active" ? "success" : "neutral"}>
          {r.status === "active" ? "Ativo" : "Inativo"}
        </Badge>
      ),
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
            title="Histórico de preço e estoque"
            onClick={() => openHistory(r)}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          {hasPermission("products.update") && (
            <Button
              size="sm"
              variant="ghost"
              title="Editar"
              onClick={() => openEdit(r)}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
          )}
          {hasPermission("products.delete") && r.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              title="Inativar"
              onClick={() => setInactivateTarget(r)}
            >
              <Power className="h-3.5 w-3.5 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Produtos</h1>
          <p className="text-xs text-slate-500">
            Catálogo de mercadorias, preços, códigos de barras e saldos por
            estabelecimento
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {hasPermission("products.create") && (
            <>
              <Button variant="outline" onClick={() => setCatModal(true)}>
                <FolderPlus className="h-4 w-4" />
                Categorias
              </Button>
              <Button variant="outline" onClick={() => setImportModal(true)}>
                <Upload className="h-4 w-4" />
                Importar CSV
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "produtos-mercato",
                ["SKU", "Barras", "Descrição", "Categoria", "Preço Venda", "Estoque", "Unidade"],
                items.map((p) => [
                  p.sku,
                  p.barcode ?? "",
                  p.name,
                  p.categoryName ?? "",
                  p.salePrice,
                  p.currentStock,
                  p.unit,
                ])
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
                "produtos-mercato",
                "Produtos",
                ["SKU", "Barras", "Descrição", "Preço Venda", "Estoque"],
                items.map((p) => [p.sku, p.barcode ?? "", p.name, p.salePrice, p.currentStock])
              )
            }
          >
            Excel
          </Button>
          {hasPermission("products.create") && (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Novo Produto
            </Button>
          )}
        </div>
      </div>

      <DataTable
        data={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        toolbar={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar descrição, SKU ou barras..."
                className="h-8 w-64 pl-8 text-xs"
              />
            </div>
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-8 w-44 text-xs"
            >
              <option value="">Todas categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="h-8 w-40 text-xs"
            >
              <option value="">Qualquer estoque</option>
              <option value="low">Estoque baixo</option>
              <option value="zero">Sem estoque</option>
            </Select>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 w-32 text-xs"
            >
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="all">Todos</option>
            </Select>
          </>
        }
      />

      {/* Drawer: Create/Edit Product */}
      <Drawer
        open={formDrawer}
        onClose={() => setFormDrawer(false)}
        title={form.id ? "Editar Produto" : "Novo Produto"}
        subtitle="Preencha os dados fiscais, comerciais e parâmetros de estoque"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormDrawer(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="product-form" loading={submitting}>
              Salvar Produto
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSave} className="space-y-4">
          <Field label="Descrição completa" required>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" required>
              <Input
                required
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </Field>
            <Field label="Código de Barras (EAN)">
              <Input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <Select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidade">
              <Select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                <option value="UN">UN - Unidade</option>
                <option value="KG">KG - Quilograma</option>
                <option value="LT">LT - Litro</option>
                <option value="CX">CX - Caixa</option>
                <option value="PCT">PCT - Pacote</option>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca">
              <Input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </Field>
            <Field label="Localização no estoque">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Ex.: Corredor A / P2"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {hasPermission("products.view_cost") && (
              <Field
                label="Preço de Custo (R$)"
                hint={`Margem estimada: ${computedMargin.toFixed(1)}%`}
              >
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                />
              </Field>
            )}
            <Field label="Preço de Venda (R$)" required>
              <Input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
              />
            </Field>
          </div>

          {form.id && (
            <Field label="Motivo da alteração de preço (se houver)">
              <Input
                value={form.priceReason}
                onChange={(e) => setForm({ ...form, priceReason: e.target.value })}
                placeholder="Ex.: Reajuste de tabela do fornecedor"
              />
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Estoque Mínimo">
              <Input
                type="number"
                step="0.001"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
              />
            </Field>
            <Field label="Estoque Máximo">
              <Input
                type="number"
                step="0.001"
                value={form.maxStock}
                onChange={(e) => setForm({ ...form, maxStock: e.target.value })}
              />
            </Field>
            {!form.id && (
              <Field label="Saldo Inicial">
                <Input
                  type="number"
                  step="0.001"
                  value={form.initialStock}
                  onChange={(e) =>
                    setForm({ ...form, initialStock: e.target.value })
                  }
                />
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-1 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.trackStock}
                onChange={(e) =>
                  setForm({ ...form, trackStock: e.target.checked })
                }
              />
              Controlar saldo de estoque deste item
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.allowFractional}
                onChange={(e) =>
                  setForm({ ...form, allowFractional: e.target.checked })
                }
              />
              Permitir venda fracionada (ex.: KG / LT)
            </label>
          </div>
        </form>
      </Drawer>

      {/* History drawer */}
      <Drawer
        open={Boolean(historyDrawer)}
        onClose={() => setHistoryDrawer(null)}
        title={historyDrawer?.product.name ?? ""}
        subtitle="Histórico de preços e movimentações de estoque"
      >
        {historyDrawer && (
          <div className="space-y-5 text-xs">
            {canViewCost && (
              <div>
                <h4 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
                  Alterações de Preço
                </h4>
                {historyDrawer.priceHistory.length === 0 ? (
                  <p className="text-slate-400">Sem alterações registradas.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                    {historyDrawer.priceHistory.map((h) => (
                      <li key={h.id} className="p-2.5">
                        <div className="flex justify-between font-medium">
                          <span>
                            Venda: {formatCurrency(h.previousPrice)} →{" "}
                            <strong className="text-[#0f4c5c]">
                              {formatCurrency(h.newPrice)}
                            </strong>
                          </span>
                          <span className="text-slate-400">
                            {formatDateTime(h.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-slate-500">
                          Custo: {formatCurrency(h.previousCost)} →{" "}
                          {formatCurrency(h.newCost)} · {h.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div>
              <h4 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
                Movimentações de Estoque
              </h4>
              {historyDrawer.movements.length === 0 ? (
                <p className="text-slate-400">Nenhuma movimentação registrada.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {historyDrawer.movements.map((m) => (
                    <li key={m.id} className="flex justify-between p-2.5">
                      <div>
                        <p className="font-semibold text-slate-800">{m.type}</p>
                        <p className="text-slate-500">
                          {m.originDocument || "Movimentação"} ·{" "}
                          {formatDateTime(m.createdAt)}
                        </p>
                      </div>
                      <div className="text-right font-mono">
                        <p className="font-bold">{m.quantity}</p>
                        <p className="text-[10px] text-slate-400">
                          {m.previousBalance} → {m.newBalance}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Modal: Category */}
      <Modal
        open={catModal}
        onClose={() => setCatModal(false)}
        title="Nova Categoria de Produto"
        size="sm"
      >
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <Field label="Nome da categoria" required>
            <Input
              required
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCatModal(false)}>
              Fechar
            </Button>
            <Button type="submit">Adicionar</Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Import CSV */}
      <Modal
        open={importModal}
        onClose={() => setImportModal(false)}
        title="Importar Produtos via CSV"
        subtitle="Use ponto e vírgula (;) como separador"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setImportModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleImportCsv} loading={submitting}>
              Processar Importação
            </Button>
          </>
        }
      >
        <Textarea
          rows={8}
          className="font-mono text-xs"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(inactivateTarget)}
        onClose={() => setInactivateTarget(null)}
        onConfirm={handleInactivate}
        title="Inativar produto?"
        description={`O produto "${inactivateTarget?.name}" será inativado sem apagar seu histórico de vendas e movimentações.`}
        confirmLabel="Inativar"
        danger
        loading={submitting}
      />
    </div>
  );
}
