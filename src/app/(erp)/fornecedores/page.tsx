"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Edit3, Plus, Search } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf } from "@/lib/format";
import {
  Badge,
  Button,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface SupplierRow {
  id: string;
  code: string;
  personType: string;
  document: string | null;
  legalName: string;
  tradeName: string | null;
  contactName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  paymentTerms: string | null;
  status: string;
}

const EMPTY_FORM = {
  id: "",
  personType: "PJ",
  document: "",
  legalName: "",
  tradeName: "",
  contactName: "",
  phone: "",
  whatsapp: "",
  email: "",
  city: "",
  state: "",
  paymentTerms: "",
  notes: "",
};

export default function FornecedoresPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [items, setItems] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const res = await fetch(`/api/suppliers${qs}`);
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch("/api/suppliers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title: isEdit ? "Fornecedor atualizado!" : "Fornecedor cadastrado!",
      });
      setDrawerOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<SupplierRow>[] = [
    {
      key: "code",
      header: "Código",
      render: (r) => <span className="font-mono font-semibold">{r.code}</span>,
    },
    {
      key: "legalName",
      header: "Fornecedor",
      sortable: true,
      sortValue: (r) => r.tradeName || r.legalName,
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900">
            {r.tradeName || r.legalName}
          </p>
          <p className="text-[11px] text-slate-500">{r.legalName}</p>
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
      key: "contact",
      header: "Contato",
      render: (r) => (
        <div className="text-[11px]">
          <p>{r.contactName || "—"}</p>
          <p className="text-slate-500">{r.phone || r.email || ""}</p>
        </div>
      ),
    },
    {
      key: "paymentTerms",
      header: "Cond. Pagamento",
      render: (r) => r.paymentTerms || "—",
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
      render: (r) =>
        hasPermission("purchases.manage") ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setForm({
                id: r.id,
                personType: r.personType,
                document: r.document ?? "",
                legalName: r.legalName,
                tradeName: r.tradeName ?? "",
                contactName: r.contactName ?? "",
                phone: r.phone ?? "",
                whatsapp: r.whatsapp ?? "",
                email: r.email ?? "",
                city: r.city ?? "",
                state: r.state ?? "",
                paymentTerms: r.paymentTerms ?? "",
                notes: "",
              });
              setDrawerOpen(true);
            }}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Fornecedores</h1>
          <p className="text-xs text-slate-500">
            Cadastro de distribuidores, fabricantes e condições comerciais
          </p>
        </div>
        {hasPermission("purchases.manage") && (
          <Button
            onClick={() => {
              setForm(EMPTY_FORM);
              setDrawerOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Novo Fornecedor
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
              placeholder="Buscar razão social, fantasia ou CNPJ..."
              className="h-8 w-72 pl-8 text-xs"
            />
          </div>
        }
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={form.id ? "Editar Fornecedor" : "Novo Fornecedor"}
        footer={
          <>
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="supplier-form" loading={submitting}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="supplier-form" onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tipo">
              <Select
                value={form.personType}
                onChange={(e) => setForm({ ...form, personType: e.target.value })}
              >
                <option value="PJ">PJ</option>
                <option value="PF">PF</option>
              </Select>
            </Field>
            <div className="col-span-2">
              <Field label="CNPJ / CPF">
                <Input
                  value={form.document}
                  onChange={(e) => setForm({ ...form, document: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <Field label="Razão Social / Nome" required>
            <Input
              required
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
          </Field>
          <Field label="Nome Fantasia">
            <Input
              value={form.tradeName}
              onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contato">
              <Input
                value={form.contactName}
                onChange={(e) =>
                  setForm({ ...form, contactName: e.target.value })
                }
              />
            </Field>
            <Field label="Condições de pagamento">
              <Input
                value={form.paymentTerms}
                onChange={(e) =>
                  setForm({ ...form, paymentTerms: e.target.value })
                }
                placeholder="Ex.: 28/56 dias"
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
            <Field label="E-mail">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>
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
    </div>
  );
}
