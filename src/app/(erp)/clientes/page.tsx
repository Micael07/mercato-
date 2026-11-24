"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Edit3, Eye, Plus, Search } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf, formatCurrency, formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Drawer,
  Field,
  Input,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  creditLimit: number;
  openBalance: number;
  status: string;
}

const EMPTY_FORM = {
  id: "",
  name: "",
  document: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  city: "",
  state: "",
  creditLimit: "0",
  notes: "",
};

export default function ClientesPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [items, setItems] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [formDrawer, setFormDrawer] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [detailDrawer, setDetailDrawer] = useState<{
    customer: CustomerRow;
    stats: { salesCount: number; totalSpent: number; averageTicket: number };
    sales: Array<{ id: string; saleNumber: number; total: number; createdAt: string }>;
    topProducts: Array<{ productName: string; quantity: number; total: number }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const res = await fetch(`/api/customers${qs}`);
      if (res.ok) setItems((await res.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/customers/${id}`);
    if (res.ok) setDetailDrawer(await res.json());
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch("/api/customers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          creditLimit: Number(form.creditLimit) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: isEdit ? "Cliente atualizado!" : "Cliente cadastrado!",
      });
      setFormDrawer(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<CustomerRow>[] = [
    {
      key: "code",
      header: "Código",
      render: (r) => <span className="font-mono font-semibold">{r.code}</span>,
    },
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900">{r.name}</p>
          <p className="text-[11px] text-slate-500">
            {r.phone || r.email || "Sem contato"}
          </p>
        </div>
      ),
    },
    {
      key: "document",
      header: "CPF / CNPJ",
      render: (r) => (
        <span className="font-mono">{formatCnpjCpf(r.document)}</span>
      ),
    },
    {
      key: "creditLimit",
      header: "Limite Crédito",
      align: "right",
      render: (r) => (
        <span className="font-mono">{formatCurrency(r.creditLimit)}</span>
      ),
    },
    {
      key: "openBalance",
      header: "Em Aberto",
      align: "right",
      render: (r) => (
        <span
          className={`font-mono font-semibold ${
            r.openBalance > 0 ? "text-amber-700" : "text-slate-600"
          }`}
        >
          {formatCurrency(r.openBalance)}
        </span>
      ),
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
            title="Histórico e compras"
            onClick={() => openDetail(r.id)}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {hasPermission("customers.manage") && (
            <Button
              size="sm"
              variant="ghost"
              title="Editar"
              onClick={() => {
                setForm({
                  id: r.id,
                  name: r.name,
                  document: r.document ?? "",
                  phone: r.phone ?? "",
                  whatsapp: r.whatsapp ?? "",
                  email: r.email ?? "",
                  address: "",
                  city: r.city ?? "",
                  state: r.state ?? "",
                  creditLimit: String(r.creditLimit),
                  notes: "",
                });
                setFormDrawer(true);
              }}
            >
              <Edit3 className="h-3.5 w-3.5" />
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
          <h1 className="text-lg font-bold text-slate-900">Clientes</h1>
          <p className="text-xs text-slate-500">
            Cadastro de clientes, histórico de consumo, ticket médio e crediário
          </p>
        </div>
        {hasPermission("customers.manage") && (
          <Button
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormDrawer(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Novo Cliente
          </Button>
        )}
      </div>

      <DataTable
        data={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        toolbar={
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nome, CPF/CNPJ ou telefone..."
              className="h-8 w-72 pl-8 text-xs"
            />
          </div>
        }
      />

      <Drawer
        open={formDrawer}
        onClose={() => setFormDrawer(false)}
        title={form.id ? "Editar Cliente" : "Novo Cliente"}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormDrawer(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="customer-form" loading={submitting}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="customer-form" onSubmit={handleSave} className="space-y-3">
          <Field label="Nome completo" required>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CPF / CNPJ">
              <Input
                value={form.document}
                onChange={(e) => setForm({ ...form, document: e.target.value })}
              />
            </Field>
            <Field label="Limite de crédito (R$)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.creditLimit}
                onChange={(e) =>
                  setForm({ ...form, creditLimit: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="WhatsApp">
              <Input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </Field>
          </div>
          <Field label="E-mail">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Cidade">
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
            </div>
            <Field label="UF">
              <Input
                maxLength={2}
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Observações">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(detailDrawer)}
        onClose={() => setDetailDrawer(null)}
        title={detailDrawer?.customer.name ?? ""}
        subtitle="Perfil de compras e situação financeira"
      >
        {detailDrawer && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-2 rounded border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-slate-500">Compras</p>
                <p className="font-mono text-base font-bold">
                  {detailDrawer.stats.salesCount}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Total gasto</p>
                <p className="font-mono text-base font-bold text-[#0f4c5c]">
                  {formatCurrency(detailDrawer.stats.totalSpent)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Ticket médio</p>
                <p className="font-mono text-base font-bold">
                  {formatCurrency(detailDrawer.stats.averageTicket)}
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-1.5 font-semibold uppercase text-slate-500">
                Produtos mais comprados
              </h4>
              {detailDrawer.topProducts.length === 0 ? (
                <p className="text-slate-400">Nenhuma compra ainda.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {detailDrawer.topProducts.map((tp) => (
                    <li
                      key={tp.productName}
                      className="flex justify-between p-2"
                    >
                      <span>{tp.productName}</span>
                      <span className="font-mono font-semibold">
                        {tp.quantity} un. · {formatCurrency(tp.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-1.5 font-semibold uppercase text-slate-500">
                Histórico de vendas
              </h4>
              {detailDrawer.sales.length === 0 ? (
                <p className="text-slate-400">Nenhuma venda registrada.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {detailDrawer.sales.map((s) => (
                    <li key={s.id} className="flex justify-between p-2">
                      <span>
                        Venda #{s.saleNumber} · {formatDate(s.createdAt)}
                      </span>
                      <span className="font-mono font-bold">
                        {formatCurrency(s.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
