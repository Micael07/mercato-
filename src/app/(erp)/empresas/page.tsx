"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Building2, Plus, Store } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf, formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Panel,
} from "@/components/ui/primitives";

interface CompanyItem {
  id: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  status: string;
  createdAt: string;
  establishments: Array<{
    id: string;
    name: string;
    code: string;
    cnpj: string | null;
    address: string | null;
    phone: string | null;
    status: string;
    isDefault: boolean;
  }>;
}

export default function EmpresasPage() {
  const { session, refreshSession } = useSession();
  const { toast } = useToast();

  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [compModal, setCompModal] = useState(false);
  const [estModal, setEstModal] = useState(false);

  const [compForm, setCompForm] = useState({
    tradeName: "",
    legalName: "",
    cnpj: "",
    establishmentName: "Matriz",
    phone: "",
    email: "",
  });
  const [estForm, setEstForm] = useState({
    name: "",
    code: "",
    cnpj: "",
    address: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/companies");
    if (res.ok) setCompanies((await res.json()).companies ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "company", ...compForm }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Nova empresa criada!" });
      setCompModal(false);
      await load();
      await refreshSession();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateEstablishment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "establishment", ...estForm }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Estabelecimento criado!" });
      setEstModal(false);
      setEstForm({ name: "", code: "", cnpj: "", address: "", phone: "" });
      await load();
      await refreshSession();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            Empresas e Estabelecimentos
          </h1>
          <p className="text-xs text-slate-500">
            Estrutura multiempresa e filiais vinculadas ao seu usuário
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEstModal(true)}>
            <Store className="h-4 w-4" />
            Novo Estabelecimento (Filial)
          </Button>
          {session?.isPlatformAdmin && (
            <Button onClick={() => setCompModal(true)}>
              <Plus className="h-4 w-4" />
              Nova Empresa
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {companies.map((c) => (
          <Panel
            key={c.id}
            title={c.tradeName}
            subtitle={`${c.legalName} · CNPJ ${formatCnpjCpf(c.cnpj)} · Desde ${formatDate(c.createdAt)}`}
            actions={
              <div className="flex items-center gap-2">
                {c.id === session?.company.id && (
                  <Badge tone="primary">Empresa ativa</Badge>
                )}
                <Badge tone={c.status === "active" ? "success" : "neutral"}>
                  {c.status === "active" ? "Ativa" : "Inativa"}
                </Badge>
              </div>
            }
          >
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Estabelecimentos ({c.establishments.length})
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {c.establishments.map((est) => (
                  <div
                    key={est.id}
                    className="flex items-start justify-between rounded border border-slate-200 bg-slate-50 p-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono text-[#0f4c5c]">
                          {est.code}
                        </span>{" "}
                        · {est.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {est.address || "Endereço não informado"}
                      </p>
                      {est.cnpj && (
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {formatCnpjCpf(est.cnpj)}
                        </p>
                      )}
                    </div>
                    {est.id === session?.establishment.id && (
                      <Badge tone="success">Atual</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <Modal
        open={compModal}
        onClose={() => setCompModal(false)}
        title="Cadastrar Nova Empresa"
        size="md"
      >
        <form onSubmit={handleCreateCompany} className="space-y-3">
          <Field label="Nome Fantasia" required>
            <Input
              required
              value={compForm.tradeName}
              onChange={(e) =>
                setCompForm({ ...compForm, tradeName: e.target.value })
              }
            />
          </Field>
          <Field label="Razão Social">
            <Input
              value={compForm.legalName}
              onChange={(e) =>
                setCompForm({ ...compForm, legalName: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CNPJ" required>
              <Input
                required
                value={compForm.cnpj}
                onChange={(e) =>
                  setCompForm({ ...compForm, cnpj: e.target.value })
                }
              />
            </Field>
            <Field label="Estabelecimento inicial" required>
              <Input
                required
                value={compForm.establishmentName}
                onChange={(e) =>
                  setCompForm({
                    ...compForm,
                    establishmentName: e.target.value,
                  })
                }
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCompModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              <Building2 className="h-4 w-4" />
              Criar Empresa
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={estModal}
        onClose={() => setEstModal(false)}
        title={`Novo Estabelecimento — ${session?.company.tradeName}`}
        size="md"
      >
        <form onSubmit={handleCreateEstablishment} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Código" required>
              <Input
                required
                value={estForm.code}
                onChange={(e) =>
                  setEstForm({ ...estForm, code: e.target.value })
                }
                placeholder="002"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Nome da unidade / filial" required>
                <Input
                  required
                  value={estForm.name}
                  onChange={(e) =>
                    setEstForm({ ...estForm, name: e.target.value })
                  }
                  placeholder="Filial Centro"
                />
              </Field>
            </div>
          </div>
          <Field label="CNPJ (se distinto)">
            <Input
              value={estForm.cnpj}
              onChange={(e) => setEstForm({ ...estForm, cnpj: e.target.value })}
            />
          </Field>
          <Field label="Endereço">
            <Input
              value={estForm.address}
              onChange={(e) =>
                setEstForm({ ...estForm, address: e.target.value })
              }
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEstModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Salvar Estabelecimento
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
