"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarPlus, Copy, KeyRound, Plus, ShieldCheck, Unlock } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf, formatDate, formatDateTime } from "@/lib/format";
import { Badge, Button, Drawer, Field, Input, Modal, Panel, Select, Textarea, type BadgeTone } from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

type State = "ok" | "expiring" | "expired" | "pending" | "suspended";
interface ClientRow {
  id: string;
  tradeName: string;
  legalName: string;
  cnpj: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  licenseStatus: "pending" | "trial" | "active" | "suspended";
  licensePlan: string | null;
  licenseExpiresAt: string | null;
  licenseNotes: string | null;
  licenseState: State;
  licenseDaysLeft: number | null;
  adminName: string | null;
  adminEmail: string | null;
  userCount: number;
  establishmentCount: number;
  lastLoginAt: string | null;
}
interface LicenseEvent {
  id: string;
  action: string;
  newStatus: string | null;
  expiresAt: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleCode: string;
  status: string;
  lastLoginAt: string | null;
}
const ROLE_LABELS: Record<string, string> = { admin: "Administrador", manager: "Gerente", cashier: "Caixa / Operador", stockist: "Estoquista" };

const EVENT_LABELS: Record<string, string> = {
  created: "Cliente criado",
  released: "Acesso liberado",
  renewed: "Licença renovada",
  suspended: "Acesso bloqueado",
  set_pending: "Voltou para aguardando",
  expiry_changed: "Vencimento alterado",
  updated: "Dados da licença alterados",
};

function stateBadge(row: ClientRow): { tone: BadgeTone; label: string } {
  const trial = row.licenseStatus === "trial" ? " · teste" : "";
  switch (row.licenseState) {
    case "ok": return { tone: "success", label: `Ativa${trial}` };
    case "expiring": return { tone: "warning", label: `Vence em ${row.licenseDaysLeft} d${trial}` };
    case "expired": return { tone: "danger", label: "Vencida" };
    case "pending": return { tone: "info", label: "Aguardando liberação" };
    default: return { tone: "danger", label: "Bloqueada" };
  }
}

const FILTERS: Array<{ id: string; label: string; match: (r: ClientRow) => boolean }> = [
  { id: "all", label: "Todos", match: () => true },
  { id: "pending", label: "Aguardando liberação", match: (r) => r.licenseState === "pending" },
  { id: "active", label: "Ativos", match: (r) => r.licenseState === "ok" || r.licenseState === "expiring" },
  { id: "expiring", label: "Vencendo (7 dias)", match: (r) => r.licenseState === "expiring" },
  { id: "expired", label: "Vencidos", match: (r) => r.licenseState === "expired" },
  { id: "suspended", label: "Bloqueados", match: (r) => r.licenseState === "suspended" },
];

function toDateInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value); // dia no fuso do navegador, o mesmo usado nas datas da tela
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Vencimento vale até 23:59:59 do dia escolhido, no fuso do navegador. */
function endOfDayIso(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

export default function PlataformaPage() {
  const { session } = useSession();
  const { toast } = useToast();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState("");
  const [notes, setNotes] = useState("");
  const [payNote, setPayNote] = useState("");
  const [expiry, setExpiry] = useState("");
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ tradeName: "", legalName: "", cnpj: "", adminName: "", adminEmail: "", phone: "", plan: "", days: "30", trial: false });

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/companies", { cache: "no-store" });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Não foi possível carregar os clientes."); return; }
      setRows((await res.json()).companies ?? []);
      setError(null);
    } catch { setError("Falha de conexão."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function open(row: ClientRow) {
    setSelectedId(row.id); setPlan(row.licensePlan ?? ""); setNotes(row.licenseNotes ?? "");
    setExpiry(toDateInput(row.licenseExpiresAt)); setPayNote(""); setEvents([]); setMembers([]);
    const [res, mres] = await Promise.all([
      fetch(`/api/platform/companies/${row.id}`, { cache: "no-store" }),
      fetch(`/api/platform/companies/${row.id}/members`, { cache: "no-store" }),
    ]);
    if (res.ok) setEvents((await res.json()).events ?? []);
    if (mres.ok) setMembers((await mres.json()).members ?? []);
  }

  async function updateMember(member: Member, change: { roleCode?: string; status?: string }, success: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/companies/${selected.id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membershipId: member.membershipId, ...change }) });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível alterar o usuário." }); return; }
      toast({ type: "success", title: success });
      const mres = await fetch(`/api/platform/companies/${selected.id}/members`, { cache: "no-store" });
      if (mres.ok) setMembers((await mres.json()).members ?? []);
    } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>, success: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/companies/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, note: payNote || undefined }) });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível salvar." }); return; }
      toast({ type: "success", title: success });
      setPayNote("");
      await load();
      const ev = await fetch(`/api/platform/companies/${selected.id}`, { cache: "no-store" });
      if (ev.ok) setEvents((await ev.json()).events ?? []);
      const refreshed = await (await fetch("/api/platform/companies", { cache: "no-store" })).json();
      const row = (refreshed.companies as ClientRow[] | undefined)?.find((c) => c.id === selected.id);
      if (row) setExpiry(toDateInput(row.licenseExpiresAt));
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/companies/${selected.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível gerar a senha." }); return; }
      setSecret({ title: "Senha provisória gerada", email: data.email, password: data.tempPassword });
    } finally { setBusy(false); }
  }

  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/platform/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newForm, days: Number(newForm.days) }) });
      const data = await res.json();
      if (!res.ok) { toast({ type: "error", title: data.error || "Não foi possível criar o cliente." }); return; }
      setNewOpen(false);
      setNewForm({ tradeName: "", legalName: "", cnpj: "", adminName: "", adminEmail: "", phone: "", plan: "", days: "30", trial: false });
      setSecret({ title: "Cliente criado", email: data.adminEmail, password: data.tempPassword });
      await load();
    } finally { setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast({ type: "success", title: "Copiado" }); }
    catch { toast({ type: "error", title: "Não foi possível copiar. Selecione e copie manualmente." }); }
  }

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.match).length])), [rows]);
  const visible = useMemo(() => {
    const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter(active.match).filter((r) => !term || [r.tradeName, r.legalName, r.cnpj, r.adminEmail ?? "", r.adminName ?? ""].some((v) => v.toLocaleLowerCase("pt-BR").includes(term)));
  }, [rows, filter, search]);

  const columns: ColumnDef<ClientRow>[] = [
    { key: "tradeName", header: "Empresa", sortable: true, sortValue: (r) => r.tradeName, render: (r) => <div><p className="font-semibold text-slate-900">{r.tradeName}</p><p className="font-mono text-[10px] text-slate-400">{formatCnpjCpf(r.cnpj)}</p></div> },
    { key: "admin", header: "Administrador", render: (r) => <div><p>{r.adminName ?? "—"}</p><p className="text-[11px] text-slate-400">{r.adminEmail ?? ""}</p></div> },
    { key: "plan", header: "Plano", render: (r) => r.licensePlan || <span className="text-slate-300">—</span> },
    { key: "state", header: "Situação", sortable: true, sortValue: (r) => r.licenseState, render: (r) => { const b = stateBadge(r); return <Badge tone={b.tone}>{b.label}</Badge>; } },
    { key: "expires", header: "Vencimento", sortable: true, sortValue: (r) => r.licenseExpiresAt ? new Date(r.licenseExpiresAt).getTime() : Number.MAX_SAFE_INTEGER, render: (r) => r.licenseExpiresAt ? formatDate(r.licenseExpiresAt) : <span className="text-slate-400">Sem vencimento</span> },
    { key: "use", header: "Uso", align: "right", defaultHidden: true, render: (r) => <span className="text-[11px] text-slate-500">{r.userCount} usuário(s) · {r.establishmentCount} unid.</span> },
    { key: "last", header: "Último acesso", defaultHidden: true, render: (r) => r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Nunca" },
    { key: "actions", header: "", align: "right", hideable: false, render: (r) => <Button size="sm" variant={r.licenseState === "pending" ? "primary" : "outline"} onClick={() => void open(r)}>{r.licenseState === "pending" ? "Liberar" : "Gerenciar"}</Button> },
  ];

  if (session && !session.isPlatformAdmin) {
    return <Panel title="Acesso restrito"><p className="text-xs text-slate-500">Esta área é exclusiva do administrador da plataforma.</p></Panel>;
  }

  const deadline = selected ? stateBadge(selected) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Clientes e licenças</h1>
          <p className="text-xs text-slate-500">Somente você libera, renova e bloqueia o acesso das empresas ao Mercato</p>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />Novo cliente</Button>
      </div>

      {counts.pending > 0 && (
        <p role="status" className="border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
          {counts.pending} cadastro(s) aguardando liberação. Confirme o pagamento e toque em “Liberar”.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtrar por situação">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={`min-h-9 border px-3 text-[11px] ${filter === f.id ? "border-sky-500 bg-sky-50 font-semibold text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
            {f.label} <span className="ml-1 font-mono text-[10px] text-slate-400">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <DataTable
        data={visible}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        emptyTitle="Nenhum cliente nesta lista"
        emptyDescription="Cadastros feitos pela tela de acesso aparecem aqui como “Aguardando liberação”."
        toolbar={<Input aria-label="Buscar cliente" placeholder="Buscar por nome, CNPJ ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} className="!h-8 w-64 max-w-full" />}
      />

      <Drawer open={!!selected} onClose={() => setSelectedId(null)} title={selected?.tradeName ?? ""} subtitle={selected ? `${selected.legalName} · ${formatCnpjCpf(selected.cnpj)}` : undefined}>
        {selected && (
          <div className="space-y-5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {deadline && <Badge tone={deadline.tone}>{deadline.label}</Badge>}
              <span className="text-slate-500">{selected.licenseExpiresAt ? `Vence em ${formatDate(selected.licenseExpiresAt)}` : "Sem vencimento definido"}</span>
            </div>

            <section className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Liberar / renovar</h4>
              <Field label="Observação do pagamento (opcional)" hint="Ex.: PIX 23/11, comprovante recebido. Fica no histórico.">
                <Input value={payNote} maxLength={500} onChange={(e) => setPayNote(e.target.value)} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                {[30, 90, 365].map((d) => (
                  <Button key={d} variant={selected.licenseState === "pending" || selected.licenseState === "expired" ? "primary" : "outline"} loading={busy} onClick={() => void patch({ extendDays: d }, `Licença liberada por mais ${d} dias`)}>
                    <CalendarPlus className="h-3.5 w-3.5" />+{d === 365 ? "12 meses" : `${d} dias`}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400">Soma a partir do vencimento atual (ou de hoje, se já venceu) e libera o acesso.</p>
            </section>

            <section className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plano e vencimento</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Plano"><Input value={plan} maxLength={60} onChange={(e) => setPlan(e.target.value)} placeholder="Ex.: Mensal" /></Field>
                <Field label="Vencimento"><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
              </div>
              <Field label="Notas internas (o cliente não vê)"><Textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" loading={busy} onClick={() => void patch({ plan, notes, expiresAt: expiry ? endOfDayIso(expiry) : null }, "Dados salvos")}>Salvar plano, vencimento e notas</Button>
                {selected.licenseStatus !== "trial" && <Button variant="ghost" loading={busy} onClick={() => void patch({ licenseStatus: "trial" }, "Marcado como período de teste")}>Marcar como teste</Button>}
              </div>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Acesso</h4>
              <div className="flex flex-wrap gap-2">
                {selected.licenseStatus === "suspended"
                  ? <Button variant="success" loading={busy} onClick={() => void patch({ licenseStatus: "active" }, "Acesso reativado")}><Unlock className="h-3.5 w-3.5" />Reativar acesso</Button>
                  : <Button variant="danger" loading={busy} onClick={() => void patch({ licenseStatus: "suspended" }, "Acesso bloqueado")}><Ban className="h-3.5 w-3.5" />Bloquear acesso agora</Button>}
                <Button variant="outline" loading={busy} onClick={() => void resetPassword()}><KeyRound className="h-3.5 w-3.5" />Gerar senha provisória</Button>
              </div>
              <p className="text-[10px] text-slate-400">Bloqueio vale na hora, inclusive para quem já está logado. A senha provisória é do administrador ({selected.adminEmail ?? "—"}) e encerra as sessões abertas dele.</p>
              <p className="text-[10px] text-slate-400">{selected.userCount} usuário(s) · {selected.establishmentCount} estabelecimento(s) · último acesso {selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : "nunca"}</p>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Usuários desta empresa ({members.length})</h4>
              {members.length === 0 ? <p className="text-slate-400">Nenhum usuário.</p> : (
                <ul className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <li key={m.membershipId} className="space-y-2 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{m.name}</p>
                          <p className="truncate text-[11px] text-slate-400">{m.email}</p>
                          <p className="text-[10px] text-slate-400">Último acesso: {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "nunca"}</p>
                        </div>
                        <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status === "active" ? "Ativo" : m.status === "pending" ? "Pendente" : "Bloqueado"}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select aria-label={`Perfil de ${m.name}`} value={m.roleCode} disabled={busy} onChange={(e) => void updateMember(m, { roleCode: e.target.value }, `Perfil de ${m.name} alterado`)} className="flex-1">
                          {Object.entries(ROLE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                        </Select>
                        {m.status === "active"
                          ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void updateMember(m, { status: "inactive" }, `${m.name} bloqueado`)}><Ban className="h-3.5 w-3.5" />Bloquear</Button>
                          : <Button size="sm" variant="success" disabled={busy} onClick={() => void updateMember(m, { status: "active" }, `${m.name} reativado`)}><Unlock className="h-3.5 w-3.5" />Reativar</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-slate-400">Bloquear um usuário vale na hora, mesmo logado. A licença da empresa não muda. A empresa sempre mantém ao menos um administrador ativo.</p>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Histórico</h4>
              {events.length === 0 ? <p className="text-slate-400">Sem registros.</p> : (
                <ul className="divide-y divide-slate-100">
                  {events.map((e) => (
                    <li key={e.id} className="py-2">
                      <p className="font-medium text-slate-700">{EVENT_LABELS[e.action] ?? e.action}{e.expiresAt ? <span className="font-normal text-slate-500"> · até {formatDate(e.expiresAt)}</span> : null}</p>
                      <p className="text-[10px] text-slate-400">{formatDateTime(e.createdAt)}{e.createdByName ? ` · ${e.createdByName}` : ""}</p>
                      {e.note && <p className="mt-0.5 text-[11px] text-slate-500">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Novo cliente" subtitle="Cria a empresa, o administrador e já libera o acesso" size="md">
        <form onSubmit={(e) => void createClient(e)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome fantasia" required><Input required maxLength={200} value={newForm.tradeName} onChange={(e) => setNewForm({ ...newForm, tradeName: e.target.value })} /></Field>
            <Field label="CNPJ / CPF" required><Input required maxLength={20} inputMode="numeric" value={newForm.cnpj} onChange={(e) => setNewForm({ ...newForm, cnpj: e.target.value })} /></Field>
          </div>
          <Field label="Razão social"><Input maxLength={200} value={newForm.legalName} onChange={(e) => setNewForm({ ...newForm, legalName: e.target.value })} placeholder="Opcional" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do administrador" required><Input required maxLength={160} value={newForm.adminName} onChange={(e) => setNewForm({ ...newForm, adminName: e.target.value })} /></Field>
            <Field label="E-mail do administrador" required><Input type="email" required maxLength={180} value={newForm.adminEmail} onChange={(e) => setNewForm({ ...newForm, adminEmail: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plano"><Input maxLength={60} value={newForm.plan} onChange={(e) => setNewForm({ ...newForm, plan: e.target.value })} placeholder="Ex.: Mensal" /></Field>
            <Field label="Dias de acesso" required><Input type="number" required min={1} max={3650} value={newForm.days} onChange={(e) => setNewForm({ ...newForm, days: e.target.value })} /></Field>
            <Field label="Telefone"><Input maxLength={30} value={newForm.phone} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={newForm.trial} onChange={(e) => setNewForm({ ...newForm, trial: e.target.checked })} />Período de teste (sem cobrança)</label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={busy}><ShieldCheck className="h-4 w-4" />Criar e liberar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ""} subtitle="Anote agora: a senha não será exibida de novo" size="sm"
        footer={<Button onClick={() => setSecret(null)}>Já anotei</Button>}>
        {secret && (
          <div className="space-y-3 text-xs">
            {[{ label: "E-mail de acesso", value: secret.email }, { label: "Senha provisória", value: secret.password }].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-slate-400">{item.label}</p><p className="break-all font-mono text-sm text-slate-900">{item.value}</p></div>
                <Button size="sm" variant="outline" onClick={() => void copy(item.value)} aria-label={`Copiar ${item.label}`}><Copy className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-slate-500">Envie ao cliente por canal seguro (WhatsApp direto) e peça para trocar a senha no primeiro acesso.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
