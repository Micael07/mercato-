"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Copy, ShieldAlert, UserCheck, UserPlus, UserX } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { ROLE_DEFINITIONS } from "@/lib/permissions";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Panel,
  Select,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleCode: string;
  maxDiscountPercent: number;
  status: string;
  lastLoginAt: string | null;
}

interface UserRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleCode: string;
  status: string;
  requestedByName: string | null;
  decidedByName: string | null;
  createdAt: string;
}
interface Seats {
  max: number;
  mode: "platform" | "company";
  active: number;
  pending: number;
  free: number;
}
interface TeamSale {
  userId: string;
  name: string;
  roleCode: string;
  status: string;
  salesCount: number;
  total: number;
  avgTicket: number;
  lastSaleAt: string | null;
}

export default function UsuariosPage() {
  const { session } = useSession();
  const { toast } = useToast();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [seats, setSeats] = useState<Seats | null>(null);
  const [teamSales, setTeamSales] = useState<TeamSale[]>([]);
  const [range, setRange] = useState(30);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      targetName: string | null;
      previousRole: string | null;
      newRole: string;
      reason: string | null;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    phone: "",
    cpf: "",
    birthDate: "",
    notes: "",
    roleCode: "cashier",
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - (range - 1) * 86400000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const [res, rres, tres] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/users/requests"),
        fetch(`/api/team/sales?from=${iso(from)}&to=${iso(to)}`),
      ]);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
        setHistory(data.history ?? []);
      }
      if (rres.ok) {
        const data = await rres.json();
        setRequests(data.requests ?? []);
        setSeats(data.seats ?? null);
      }
      if (tres.ok) setTeamSales((await tres.json()).rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/users/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      setInviteModal(false);
      toast({
        type: "success",
        title: "Solicitação enviada",
        description:
          seats?.mode === "company"
            ? "Você pode autorizar agora na lista abaixo."
            : "Aguarde a autorização do administrador da plataforma.",
      });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (id: string, action: "approve" | "reject" | "cancel") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/users/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      if (action === "approve") setSecret({ email: data.email, password: data.tempPassword });
      else toast({ type: "success", title: "Solicitação atualizada" });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const updateMembership = async (
    membershipId: string,
    patch: { roleCode?: string; status?: string; maxDiscountPercent?: number }
  ) => {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId, ...patch }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: data.error });
      return;
    }
    toast({ type: "success", title: "Vínculo atualizado!" });
    load();
  };

  const resetPassword = async (m: MemberRow) => {
    if (!window.confirm(`Gerar nova senha provisória para ${m.name}? Ele será desconectado e terá de trocá-la no próximo acesso.`)) return;
    const res = await fetch(`/api/users/${m.membershipId}/reset-password`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: data.error });
      return;
    }
    setSecret({ email: data.email, password: data.tempPassword });
  };

  const columns: ColumnDef<MemberRow>[] = [
    {
      key: "name",
      header: "Usuário",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900">{r.name}</p>
          <p className="text-[11px] text-slate-500">{r.email}</p>
        </div>
      ),
    },
    {
      key: "roleCode",
      header: "Perfil",
      render: (r) => (
        <Select
          aria-label={`Perfil de ${r.name}`}
          value={r.roleCode}
          onChange={(e) =>
            updateMembership(r.membershipId, { roleCode: e.target.value })
          }
          className="h-8 w-44 text-xs"
        >
          {Object.entries(ROLE_DEFINITIONS).map(([code, def]) => (
            <option key={code} value={code}>
              {def.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "maxDiscountPercent",
      header: "Desc. Máx (%)",
      align: "right",
      render: (r) => (
        <span className="font-mono">{r.maxDiscountPercent}%</span>
      ),
    },
    {
      key: "lastLoginAt",
      header: "Último acesso",
      render: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Nunca"),
    },
    {
      key: "status",
      header: "Status",
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
        <div className="flex items-center justify-end gap-1">
        {r.userId !== session?.user.id && (
          <Button size="sm" variant="ghost" onClick={() => void resetPassword(r)}>
            Senha provisória
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            updateMembership(r.membershipId, {
              status: r.status === "active" ? "inactive" : "active",
            })
          }
        >
          {r.status === "active" ? (
            <>
              <UserX className="h-3.5 w-3.5 text-red-600" /> Desativar
            </>
          ) : (
            <>
              <UserCheck className="h-3.5 w-3.5 text-emerald-600" /> Ativar
            </>
          )}
        </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            Usuários da Empresa
          </h1>
          <p className="text-xs text-slate-500">
            Solicite novos acessos, acompanhe o limite contratado e veja as
            vendas de cada colaborador
          </p>
        </div>
        <Button
          disabled={!!seats && seats.active + seats.pending >= seats.max}
          onClick={() => {
            setInviteForm({ name: "", email: "", phone: "", cpf: "", birthDate: "", notes: "", roleCode: "cashier" });
            setInviteModal(true);
          }}
        >
          <UserPlus className="h-4 w-4" />
          Solicitar usuário
        </Button>
      </div>

      {seats && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white px-4 py-3 text-xs">
          <p className="text-slate-700">
            <span className="font-mono text-base font-bold">{seats.active}/{seats.max}</span>{" "}
            usuários ativos
            {seats.pending > 0 && <> · {seats.pending} solicitação(ões) pendente(s)</>}
          </p>
          <p className="text-slate-500">
            {seats.active + seats.pending >= seats.max
              ? "Limite atingido. Para liberar mais acessos, fale com o administrador da plataforma."
              : seats.mode === "company"
                ? "Você pode autorizar novos usuários até o limite."
                : "Novos usuários são autorizados pelo administrador da plataforma."}
          </p>
        </div>
      )}

      <DataTable
        data={members}
        columns={columns}
        rowKey={(r) => r.membershipId}
        loading={loading}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Solicitações de usuário" noPadding>
          {requests.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">Nenhuma solicitação.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {requests.map((q) => (
                <li key={q.id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{q.name}</p>
                      <p className="text-slate-500">
                        {q.email} · {ROLE_DEFINITIONS[q.roleCode as keyof typeof ROLE_DEFINITIONS]?.name ?? q.roleCode}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatDateTime(q.createdAt)}
                        {q.decidedByName ? ` · decidido por ${q.decidedByName}` : ""}
                      </p>
                    </div>
                    <Badge tone={q.status === "approved" ? "success" : q.status === "pending" ? "warning" : "neutral"}>
                      {q.status === "pending" ? "Aguardando" : q.status === "approved" ? "Autorizado" : q.status === "rejected" ? "Recusado" : "Cancelado"}
                    </Badge>
                  </div>
                  {q.status === "pending" && (
                    <div className="flex gap-2">
                      {seats?.mode === "company" && (
                        <Button size="sm" disabled={submitting} onClick={() => decide(q.id, "approve")}>
                          Autorizar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={submitting} onClick={() => decide(q.id, "cancel")}>
                        Cancelar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Histórico de alterações de perfil" noPadding>
          {history.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">
              Nenhuma alteração de perfil registrada.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {history.map((h) => (
                <li key={h.id} className="p-3">
                  <p className="font-semibold text-slate-800">
                    {h.targetName}: {h.previousRole} → {h.newRole}
                  </p>
                  <p className="text-slate-500">
                    {formatDateTime(h.createdAt)} · {h.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Vendas por colaborador"
        noPadding
        actions={
          <Select aria-label="Período" value={range} onChange={(e) => setRange(Number(e.target.value))} className="h-8 w-36 text-xs">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </Select>
        }
      >
        {teamSales.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-[11px] text-slate-500">
                <tr>
                  <th className="p-2.5">Colaborador</th>
                  <th className="p-2.5 text-right">Vendas</th>
                  <th className="p-2.5 text-right">Total</th>
                  <th className="p-2.5 text-right">Ticket médio</th>
                  <th className="p-2.5">Última venda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamSales.map((t) => (
                  <tr key={t.userId}>
                    <td className="p-2.5 font-semibold text-slate-800">
                      {t.name}
                      <span className="ml-1 font-normal text-slate-400">{ROLE_DEFINITIONS[t.roleCode as keyof typeof ROLE_DEFINITIONS]?.name ?? t.roleCode}{t.status !== "active" ? " · inativo" : ""}</span>
                    </td>
                    <td className="p-2.5 text-right font-mono">{t.salesCount}</td>
                    <td className="p-2.5 text-right font-mono font-semibold">{formatCurrency(t.total)}</td>
                    <td className="p-2.5 text-right font-mono">{formatCurrency(t.avgTicket)}</td>
                    <td className="p-2.5 text-slate-500">{t.lastSaleAt ? formatDateTime(t.lastSaleAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Senha provisória" size="sm">
        {secret && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">Entregue estes dados ao colaborador. A senha só aparece agora e deve ser trocada no primeiro acesso.</p>
            <div className="space-y-1 border border-emerald-200 bg-emerald-50 p-3">
              <p>E-mail: <strong>{secret.email}</strong></p>
              <p>Senha provisória: <code className="font-mono text-sm font-bold">{secret.password}</code></p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(`E-mail: ${secret.email}\nSenha: ${secret.password}`)}>
                <Copy className="h-3.5 w-3.5" /> Copiar
              </Button>
              <Button onClick={() => setSecret(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={inviteModal}
        onClose={() => setInviteModal(false)}
        title="Solicitar novo usuário"
        size="sm"
      >
        <form onSubmit={handleRequest} className="space-y-3">
          <Field label="Nome completo (nome e sobrenome)" required>
            <Input required value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} />
          </Field>
          <Field label="E-mail (será o login)" required>
            <Input type="email" required value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
          </Field>
          <Field label="CPF" required hint="Usado só para o colaborador recuperar a própria senha. Não fica salvo em texto aberto.">
            <Input required inputMode="numeric" placeholder="000.000.000-00" value={inviteForm.cpf} onChange={(e) => setInviteForm({ ...inviteForm, cpf: e.target.value })} />
          </Field>
          <Field label="Data de nascimento" required>
            <Input required type="date" value={inviteForm.birthDate} onChange={(e) => setInviteForm({ ...inviteForm, birthDate: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={inviteForm.phone} onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })} />
          </Field>
          <Field label="Perfil">
            <Select value={inviteForm.roleCode} onChange={(e) => setInviteForm({ ...inviteForm, roleCode: e.target.value })}>
              {Object.entries(ROLE_DEFINITIONS).map(([code, def]) => (
                <option key={code} value={code}>{def.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Observação">
            <Input value={inviteForm.notes} onChange={(e) => setInviteForm({ ...inviteForm, notes: e.target.value })} placeholder="Ex.: caixa do turno da manhã" />
          </Field>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>
              {seats?.mode === "company"
                ? "Depois de enviar, você mesmo autoriza na lista de solicitações."
                : "O acesso só é criado depois da autorização do administrador da plataforma."}
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setInviteModal(false)}>Fechar</Button>
            <Button type="submit" loading={submitting}>Enviar solicitação</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
