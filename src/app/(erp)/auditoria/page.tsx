"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Drawer, Select } from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface AuditRow {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  previousData: unknown;
  newData: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export default function AuditoriaPage() {
  const { session } = useSession();

  const [items, setItems] = useState<AuditRow[]>([]);
  const [entityFilter, setEntityFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = entityFilter !== "all" ? `?entity=${entityFilter}` : "";
      const res = await fetch(`/api/audit${qs}`);
      if (res.ok) setItems((await res.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [entityFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const columns: ColumnDef<AuditRow>[] = [
    {
      key: "createdAt",
      header: "Data / Hora",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="font-mono text-[11px]">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: "userName",
      header: "Usuário",
      render: (r) => r.userName || "Sistema",
    },
    {
      key: "action",
      header: "Ação",
      render: (r) => {
        const isDanger =
          r.action.includes("unauthorized") ||
          r.action.includes("cancel") ||
          r.action.includes("failed");
        return (
          <Badge tone={isDanger ? "danger" : "primary"}>{r.action}</Badge>
        );
      },
    },
    {
      key: "entity",
      header: "Entidade",
      render: (r) => (
        <span className="font-mono text-[11px] text-slate-700">
          {r.entity}
          {r.entityId ? ` (${r.entityId.slice(0, 8)})` : ""}
        </span>
      ),
    },
    {
      key: "ipAddress",
      header: "Origem",
      render: (r) => (
        <span className="font-mono text-[11px] text-slate-500">
          {r.ipAddress || "local"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Dados",
      align: "right",
      hideable: false,
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
          <Eye className="h-3.5 w-3.5" />
          Inspecionar
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">
          Trilha de Auditoria (Somente Leitura)
        </h1>
        <p className="text-xs text-slate-500">
          Registro imutável de acessos, vendas, cancelamentos, estoque, preços e
          alterações administrativas
        </p>
      </div>

      <DataTable
        data={items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        toolbar={
          <Select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="h-8 w-48 text-xs"
          >
            <option value="all">Todas as entidades</option>
            <option value="auth">Autenticação</option>
            <option value="permission">Permissões / Segurança</option>
            <option value="sale">Vendas</option>
            <option value="cash_register">Caixa</option>
            <option value="product">Produtos e Estoque</option>
            <option value="purchase_order">Compras</option>
            <option value="financial_entry">Financeiro</option>
            <option value="company_settings">Configurações</option>
            <option value="company_user">Usuários</option>
          </Select>
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={`Evento: ${selected?.action ?? ""}`}
        subtitle={
          selected
            ? `${formatDateTime(selected.createdAt)} · ${selected.userName || "Sistema"}`
            : undefined
        }
      >
        {selected && (
          <div className="space-y-4 text-xs">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
              <p>
                <strong>Entidade:</strong> {selected.entity} ({selected.entityId})
              </p>
              <p>
                <strong>IP:</strong> {selected.ipAddress || "Não informado"}
              </p>
              <p className="break-all">
                <strong>User-Agent:</strong> {selected.userAgent || "—"}
              </p>
            </div>

            {selected.previousData !== null && (
              <div>
                <p className="mb-1 font-semibold uppercase text-slate-500">
                  Dados anteriores
                </p>
                <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
                  {JSON.stringify(selected.previousData, null, 2)}
                </pre>
              </div>
            )}

            {selected.newData !== null && (
              <div>
                <p className="mb-1 font-semibold uppercase text-slate-500">
                  Dados posteriores
                </p>
                <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
                  {JSON.stringify(selected.newData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
