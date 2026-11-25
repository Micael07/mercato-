"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Copy, KeyRound, LogOut, Unlock } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Drawer, Field, Input, Modal, Panel, Select } from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

const ROLE_LABELS: Record<string, string> = { admin: "Administrador", manager: "Gerente", cashier: "Caixa / Operador", stockist: "Estoquista" };

interface Membership { membershipId: string; companyId: string; companyName: string; roleCode: string; status: string }
interface UserRow {
  id: string; name: string; email: string; phone: string | null; status: string;
  mustChangePassword: boolean; recoveryConfigured: boolean; recoveryLockedUntil: string | null;
  lastLoginAt: string | null; passwordChangedAt: string | null; createdAt: string;
  isPlatformAdmin: boolean; memberships: Membership[];
}

export default function PlataformaUsuariosPage() {
  const { session } = useSession();
  const { toast } = useToast();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", cpf: "", birthDate: "" });
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/users", { cache: "no-store" });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Não foi possível carregar os usuários."); return; }
      setRows((await res.json()).users ?? []);
      setError(null);
    } catch { setError("Falha de conexão."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const companies = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.memberships.forEach((x) => m.set(x.companyId, x.companyName)));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((r) =>
      (companyFilter === "all" || r.memberships.some((m) => m.companyId === companyFilter)) &&
      (statusFilter === "all" || (statusFilter === "blocked" ? r.status !== "active" : statusFilter === "pending" ? r.mustChangePassword : statusFilter === "norecovery" ? !r.recoveryConfigured : r.status === "active")) &&
      (!term || [r.name, r.email, r.phone ?? "", ...r.memberships.map((m) => m.companyName)].some((v) => v.toLocaleLowerCase("pt-BR").includes(term)))
    );
  }, [rows, search, companyFilter, statusFilter]);

  function openUser(r: UserRow) {
    setSelectedId(r.id);
    setForm({ name: r.name, email: r.email, phone: r.phone ?? "", cpf: "", birthDate: "" });
  }

  async function call(body: Record<string, unknown>, success: string, onOk?: (d: Record<string, string>) => void) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/users/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível salvar." }); return; }
      toast({ type: "success", title: data.recoveryCleared ? `${success}. A recuperação por CPF foi limpa: peça ao usuário para recadastrar ou informe CPF e nascimento.` : success });
      onOk?.(data);
      await load();
      setForm((f) => ({ ...f, cpf: "", birthDate: "" }));
    } finally { setBusy(false); }
  }

  async function memberPatch(m: Membership, change: { roleCode?: string; status?: string }, success: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/companies/${m.companyId}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membershipId: m.membershipId, ...change }) });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível alterar." }); return; }
      toast({ type: "success", title: success });
      await load();
    } finally { setBusy(false); }
  }

  const columns: ColumnDef<UserRow>[] = [
    { key: "name", header: "Usuário", sortable: true, sortValue: (r) => r.name, render: (r) => <div><p className="font-semibold text-slate-900">{r.name}{r.isPlatformAdmin && <span className="ml-1.5 text-[10px] font-normal text-sky-600">ADM master</span>}</p><p className="text-[11px] text-slate-400">{r.email}</p></div> },
    { key: "companies", header: "Empresa · perfil", render: (r) => r.memberships.length === 0 ? <span className="text-slate-300">—</span> : <div className="space-y-0.5">{r.memberships.map((m) => <p key={m.membershipId} className="text-[11px]"><span className="font-medium text-slate-700">{m.companyName}</span> <span className="text-slate-400">· {ROLE_LABELS[m.roleCode] ?? m.roleCode}{m.status !== "active" ? " · bloqueado" : ""}</span></p>)}</div> },
    { key: "status", header: "Situação", sortable: true, sortValue: (r) => r.status, render: (r) => <div className="flex flex-wrap gap-1"><Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status === "active" ? "Ativo" : "Bloqueado"}</Badge>{r.mustChangePassword && <Badge tone="warning">Senha provisória</Badge>}</div> },
    { key: "recovery", header: "Recuperação", defaultHidden: true, render: (r) => r.recoveryConfigured ? <Badge tone="success">Cadastrada</Badge> : <Badge tone="neutral">Pendente</Badge> },
    { key: "last", header: "Último acesso", sortable: true, sortValue: (r) => r.lastLoginAt ? new Date(r.lastLoginAt).getTime() : 0, render: (r) => r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Nunca" },
    { key: "actions", header: "", align: "right", hideable: false, render: (r) => <Button size="sm" variant="outline" onClick={() => openUser(r)}>Gerenciar</Button> },
  ];

  if (session && !session.isPlatformAdmin) {
    return <Panel title="Acesso restrito"><p className="text-xs text-slate-500">Esta área é exclusiva do administrador da plataforma.</p></Panel>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Todos os usuários</h1>
          <p className="text-xs text-slate-500">Usuários de todas as empresas: corrija dados, redefina senha, bloqueie e ajuste perfis</p>
        </div>
        <Link href="/plataforma"><Button variant="outline"><ArrowLeft className="h-4 w-4" />Clientes e licenças</Button></Link>
      </div>

      <DataTable
        data={visible}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        emptyTitle="Nenhum usuário encontrado"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Buscar usuário" placeholder="Nome, e-mail, telefone ou empresa…" value={search} onChange={(e) => setSearch(e.target.value)} className="!h-8 w-64 max-w-full" />
            <Select aria-label="Empresa" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="!h-8 w-48 text-xs">
              <option value="all">Todas as empresas</option>
              {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
            <Select aria-label="Situação" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!h-8 w-52 text-xs">
              <option value="all">Todas as situações</option>
              <option value="active">Ativos</option>
              <option value="blocked">Bloqueados</option>
              <option value="pending">Com senha provisória</option>
              <option value="norecovery">Sem dados de recuperação</option>
            </Select>
            <span className="text-[11px] text-slate-400">{visible.length} de {rows.length}</span>
          </div>
        }
      />

      <Drawer open={!!selected} onClose={() => setSelectedId(null)} title={selected?.name ?? ""} subtitle={selected?.email}>
        {selected && (
          <div className="space-y-5 text-xs">
            <section className="space-y-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Dados</h4>
              <Field label="Nome completo"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="E-mail (login)" hint={selected.isPlatformAdmin ? "Definido por PLATFORM_ADMIN_EMAILS." : undefined}><Input type="email" value={form.email} disabled={selected.isPlatformAdmin} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Telefone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <div className="space-y-2 border border-slate-100 p-3">
                <p className="text-[11px] text-slate-500">Recuperação de senha: {selected.recoveryConfigured ? "cadastrada" : "pendente"}. CPF e nascimento nunca são exibidos; informe para cadastrar ou substituir.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="CPF"><Input inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} /></Field>
                  <Field label="Nascimento"><Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></Field>
                </div>
                {selected.recoveryLockedUntil && new Date(selected.recoveryLockedUntil) > new Date() && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void call({ unlockRecovery: true }, "Recuperação desbloqueada")}>Desbloquear recuperação</Button>
                )}
              </div>
              <Button loading={busy} onClick={() => void call({ name: form.name, email: form.email, phone: form.phone, ...(form.cpf || form.birthDate ? { cpf: form.cpf, birthDate: form.birthDate } : {}) }, "Dados salvos")}>Salvar dados</Button>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Acesso</h4>
              <p className="text-slate-500">Último acesso: {selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : "nunca"} · Senha alterada: {selected.passwordChangedAt ? formatDateTime(selected.passwordChangedAt) : "—"}{selected.mustChangePassword ? " · aguardando troca da senha provisória" : ""}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Gerar senha provisória para ${selected.name}? Ele será desconectado.`)) void call({ action: "reset-password" }, "Senha provisória gerada", (d) => setSecret({ email: d.email, password: d.tempPassword })); }}><KeyRound className="h-3.5 w-3.5" />Senha provisória</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void call({ action: "force-logout" }, "Sessões encerradas")}><LogOut className="h-3.5 w-3.5" />Desconectar</Button>
                {!selected.isPlatformAdmin && (selected.status === "active"
                  ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void call({ status: "inactive" }, "Usuário bloqueado em todas as empresas")}><Ban className="h-3.5 w-3.5" />Bloquear</Button>
                  : <Button size="sm" variant="success" disabled={busy} onClick={() => void call({ status: "active" }, "Usuário reativado")}><Unlock className="h-3.5 w-3.5" />Reativar</Button>)}
              </div>
              <p className="text-[10px] text-slate-400">Bloquear aqui vale para todas as empresas do usuário. Para bloquear só em uma empresa, use o perfil abaixo.</p>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Empresas e perfil</h4>
              {selected.memberships.length === 0 ? <p className="text-slate-400">Sem vínculo com empresas.</p> : (
                <ul className="divide-y divide-slate-100">
                  {selected.memberships.map((m) => (
                    <li key={m.membershipId} className="space-y-2 py-2.5">
                      <p className="font-medium text-slate-800">{m.companyName} <span className="font-normal text-slate-400">· {m.status === "active" ? "ativo" : "bloqueado"}</span></p>
                      <div className="flex items-center gap-2">
                        <Select aria-label={`Perfil em ${m.companyName}`} value={m.roleCode} disabled={busy} onChange={(e) => void memberPatch(m, { roleCode: e.target.value }, "Perfil alterado")} className="flex-1">
                          {Object.entries(ROLE_LABELS).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                        </Select>
                        {m.status === "active"
                          ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void memberPatch(m, { status: "inactive" }, "Bloqueado nesta empresa")}>Bloquear</Button>
                          : <Button size="sm" variant="success" disabled={busy} onClick={() => void memberPatch(m, { status: "active" }, "Reativado nesta empresa")}>Reativar</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Senha provisória" size="sm">
        {secret && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">Entregue ao usuário. A senha só aparece agora e deve ser trocada no primeiro acesso.</p>
            <div className="space-y-1 border border-emerald-200 bg-emerald-50 p-3">
              <p>E-mail: <strong>{secret.email}</strong></p>
              <p>Senha provisória: <code className="font-mono text-sm font-bold">{secret.password}</code></p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(`E-mail: ${secret.email}\nSenha: ${secret.password}`)}><Copy className="h-3.5 w-3.5" />Copiar</Button>
              <Button onClick={() => setSecret(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
