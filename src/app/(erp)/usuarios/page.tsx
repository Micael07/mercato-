"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MailPlus, ShieldAlert, UserCheck, UserX } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
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

export default function UsuariosPage() {
  const { session } = useSession();
  const { toast } = useToast();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<
    Array<{
      id: string;
      email: string;
      roleCode: string;
      status: string;
      token: string;
      expiresAt: string;
    }>
  >([]);
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
    roleCode: "cashier",
  });
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
        setInvites(data.invites ?? []);
        setHistory(data.history ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      setCreatedInviteLink(data.acceptUrl);
      toast({
        type: "success",
        title: "Convite gerado!",
        description: "Compartilhe o link seguro ou configure SMTP.",
      });
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
            Convites por e-mail, definição de perfis e proteção ao último
            administrador
          </p>
        </div>
        <Button
          onClick={() => {
            setCreatedInviteLink(null);
            setInviteForm({ name: "", email: "", roleCode: "cashier" });
            setInviteModal(true);
          }}
        >
          <MailPlus className="h-4 w-4" />
          Convidar Usuário
        </Button>
      </div>

      <DataTable
        data={members}
        columns={columns}
        rowKey={(r) => r.membershipId}
        loading={loading}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Convites enviados" noPadding>
          {invites.length === 0 ? (
            <p className="p-4 text-xs text-slate-400">Nenhum convite pendente.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{inv.email}</p>
                    <p className="text-slate-500">
                      Perfil: {inv.roleCode} ·{" "}
                      <code className="text-[10px]">
                        /accept-invite?token={inv.token}
                      </code>
                    </p>
                  </div>
                  <Badge
                    tone={inv.status === "accepted" ? "success" : "warning"}
                  >
                    {inv.status}
                  </Badge>
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

      <Modal
        open={inviteModal}
        onClose={() => setInviteModal(false)}
        title="Convidar Novo Usuário"
        size="sm"
      >
        <form onSubmit={handleInvite} className="space-y-3">
          <Field label="Nome">
            <Input
              value={inviteForm.name}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, name: e.target.value })
              }
            />
          </Field>
          <Field label="E-mail corporativo" required>
            <Input
              type="email"
              required
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, email: e.target.value })
              }
            />
          </Field>
          <Field label="Perfil inicial">
            <Select
              value={inviteForm.roleCode}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, roleCode: e.target.value })
              }
            >
              {Object.entries(ROLE_DEFINITIONS).map(([code, def]) => (
                <option key={code} value={code}>
                  {def.name}
                </option>
              ))}
            </Select>
          </Field>

          {createdInviteLink && (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
              <p className="font-semibold">Link de aceite gerado:</p>
              <code className="mt-1 block break-all text-[11px]">
                {createdInviteLink}
              </code>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>
              Caso o provedor SMTP/Resend não esteja configurado, copie o link
              gerado para envio manual.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setInviteModal(false)}>
              Fechar
            </Button>
            <Button type="submit" loading={submitting}>
              Gerar Convite
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
