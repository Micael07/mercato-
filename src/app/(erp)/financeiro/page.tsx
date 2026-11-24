"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Plus, RotateCcw } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import {
  downloadCsv,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import {
  Badge,
  BadgeTone,
  Button,
  Field,
  Input,
  Modal,
  Panel,
  Select,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface FinancialEntryRow {
  id: string;
  type: "payable" | "receivable";
  originType: string;
  description: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  effectiveStatus: string;
  supplierName: string | null;
  customerName: string | null;
  categoryName: string | null;
}

const FIN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Em aberto", tone: "info" },
  partial: { label: "Parcial", tone: "warning" },
  paid: { label: "Quitado", tone: "success" },
  overdue: { label: "Vencido", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

export default function FinanceiroPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [tab, setTab] = useState<"all" | "payable" | "receivable" | "cashflow" | "categories">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [items, setItems] = useState<FinancialEntryRow[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; type: string; groupName: string | null }>
  >([]);
  const [settlements, setSettlements] = useState<
    Array<{
      id: string;
      entryId: string;
      amount: number;
      paymentMethodCode: string;
      settledAt: string;
      reversedAt: string | null;
    }>
  >([]);
  const [summary, setSummary] = useState({
    realizedIn: 0,
    realizedOut: 0,
    realizedBalance: 0,
    projectedIn: 0,
    projectedOut: 0,
    projectedBalance: 0,
  });
  const [loading, setLoading] = useState(true);

  const [createModal, setCreateModal] = useState(false);
  const [entryForm, setEntryForm] = useState({
    type: "payable",
    description: "",
    amount: "",
    dueDate: new Date().toISOString().slice(0, 10),
    categoryId: "",
    recurrence: "none",
  });

  const [settleTarget, setSettleTarget] = useState<FinancialEntryRow | null>(null);
  const [settleForm, setSettleForm] = useState({
    amount: "",
    interest: "0",
    penalty: "0",
    discount: "0",
    paymentMethodCode: "pix",
  });

  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState<"income" | "expense">("expense");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (tab === "payable" || tab === "receivable") qs.set("type", tab);
      if (statusFilter !== "all") qs.set("status", statusFilter);
      const res = await fetch(`/api/financial?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setCategories(data.categories ?? []);
        setSettlements(data.settlements ?? []);
        setSummary(data.summary ?? summary);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id, session?.establishment.id]);

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/financial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...entryForm,
          amount: Number(entryForm.amount) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Lançamento registrado!" });
      setCreateModal(false);
      setEntryForm({
        type: "payable",
        description: "",
        amount: "",
        dueDate: new Date().toISOString().slice(0, 10),
        categoryId: "",
        recurrence: "none",
      });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/financial/${settleTarget.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(settleForm.amount) || 0,
          interest: Number(settleForm.interest) || 0,
          penalty: Number(settleForm.penalty) || 0,
          discount: Number(settleForm.discount) || 0,
          paymentMethodCode: settleForm.paymentMethodCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Baixa registrada!" });
      setSettleTarget(null);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (settlementId: string, entryId: string) => {
    const res = await fetch(`/api/financial/${entryId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reverse",
        settlementId,
        reason: "Estorno manual pelo financeiro",
      }),
    });
    if (res.ok) {
      toast({ type: "info", title: "Baixa estornada!" });
      load();
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/financial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "category", name: catName, type: catType }),
    });
    if (res.ok) {
      toast({ type: "success", title: "Categoria criada!" });
      setCatName("");
      load();
    }
  };

  const columns: ColumnDef<FinancialEntryRow>[] = [
    {
      key: "dueDate",
      header: "Vencimento",
      sortable: true,
      sortValue: (r) => r.dueDate,
      render: (r) => <span className="font-mono">{formatDate(r.dueDate)}</span>,
    },
    {
      key: "type",
      header: "Tipo",
      render: (r) => (
        <Badge tone={r.type === "receivable" ? "success" : "warning"}>
          {r.type === "receivable" ? "A Receber" : "A Pagar"}
        </Badge>
      ),
    },
    {
      key: "description",
      header: "Descrição / Pessoa",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.description}</p>
          <p className="text-[11px] text-slate-500">
            {r.supplierName || r.customerName || r.categoryName || "Manual"}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      render: (r) => (
        <span className="font-mono font-semibold">
          {formatCurrency(r.amount)}
        </span>
      ),
    },
    {
      key: "paidAmount",
      header: "Pago",
      align: "right",
      render: (r) => (
        <span className="font-mono text-slate-600">
          {formatCurrency(r.paidAmount)}
        </span>
      ),
    },
    {
      key: "effectiveStatus",
      header: "Situação",
      render: (r) => {
        const st = FIN_STATUS[r.effectiveStatus] ?? {
          label: r.effectiveStatus,
          tone: "neutral" as BadgeTone,
        };
        return <Badge tone={st.tone}>{st.label}</Badge>;
      },
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      hideable: false,
      render: (r) =>
        hasPermission("finance.manage") &&
        r.status !== "paid" &&
        r.status !== "cancelled" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSettleTarget(r);
              setSettleForm({
                amount: r.remainingAmount.toFixed(2),
                interest: "0",
                penalty: "0",
                discount: "0",
                paymentMethodCode: "pix",
              });
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
            Baixar
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Financeiro</h1>
          <p className="text-xs text-slate-500">
            Contas a pagar, contas a receber, fluxo de caixa, baixas e estornos
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "financeiro-mercato",
                ["Vencimento", "Tipo", "Descrição", "Valor", "Pago", "Status"],
                items.map((i) => [
                  i.dueDate,
                  i.type === "receivable" ? "Receber" : "Pagar",
                  i.description,
                  i.amount,
                  i.paidAmount,
                  i.effectiveStatus,
                ])
              )
            }
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          {hasPermission("finance.manage") && (
            <Button onClick={() => setCreateModal(true)}>
              <Plus className="h-4 w-4" />
              Novo Lançamento
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {[
          { id: "all", label: "Todos os títulos" },
          { id: "payable", label: "Contas a pagar" },
          { id: "receivable", label: "Contas a receber" },
          { id: "cashflow", label: "Fluxo de caixa & Baixas" },
          { id: "categories", label: "Categorias" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-[#0f4c5c] text-[#0f4c5c]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cashflow" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-[11px] uppercase text-slate-500">
                Realizado (Entradas - Saídas)
              </p>
              <p className="mt-1 font-mono text-xl font-bold text-slate-900">
                {formatCurrency(summary.realizedBalance)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Recebido: {formatCurrency(summary.realizedIn)} · Pago:{" "}
                {formatCurrency(summary.realizedOut)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-[11px] uppercase text-slate-500">
                A Receber / A Pagar (Em aberto)
              </p>
              <p className="mt-1 font-mono text-base font-semibold text-emerald-700">
                + {formatCurrency(summary.projectedIn)}
              </p>
              <p className="font-mono text-base font-semibold text-red-700">
                - {formatCurrency(summary.projectedOut)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-[11px] uppercase text-slate-500">
                Saldo Projetado Final
              </p>
              <p className="mt-1 font-mono text-xl font-bold text-[#0f4c5c]">
                {formatCurrency(summary.projectedBalance)}
              </p>
            </div>
          </div>

          <Panel title="Últimas baixas e estornos" noPadding>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Forma</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{formatDateTime(s.settledAt)}</td>
                    <td className="px-3 py-2 uppercase">{s.paymentMethodCode}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {formatCurrency(s.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={s.reversedAt ? "danger" : "success"}>
                        {s.reversedAt ? "Estornada" : "Efetivada"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!s.reversedAt && hasPermission("finance.manage") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleReverse(s.id, s.entryId)}
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-red-600" />
                          Estornar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      ) : tab === "categories" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Categorias financeiras" noPadding>
            <ul className="divide-y divide-slate-100">
              {categories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between px-4 py-2.5 text-xs"
                >
                  <span className="font-medium">{c.name}</span>
                  <Badge tone={c.type === "income" ? "success" : "warning"}>
                    {c.type === "income" ? "Receita" : "Despesa"}
                  </Badge>
                </li>
              ))}
            </ul>
          </Panel>
          {hasPermission("finance.manage") && (
            <Panel title="Nova categoria financeira">
              <form onSubmit={handleCreateCategory} className="space-y-3">
                <Field label="Nome" required>
                  <Input
                    required
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                  />
                </Field>
                <Field label="Tipo">
                  <Select
                    value={catType}
                    onChange={(e) =>
                      setCatType(e.target.value as "income" | "expense")
                    }
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </Select>
                </Field>
                <Button type="submit">Salvar Categoria</Button>
              </form>
            </Panel>
          )}
        </div>
      ) : (
        <DataTable
          data={items}
          columns={columns}
          rowKey={(r) => r.id}
          loading={loading}
          toolbar={
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 w-44 text-xs"
            >
              <option value="all">Todas as situações</option>
              <option value="open">Em aberto</option>
              <option value="partial">Parcial</option>
              <option value="paid">Quitado</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          }
        />
      )}

      {/* Modal: New entry */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Novo Lançamento Financeiro"
        size="md"
      >
        <form onSubmit={handleCreateEntry} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Natureza">
              <Select
                value={entryForm.type}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, type: e.target.value })
                }
              >
                <option value="payable">Conta a Pagar (Despesa)</option>
                <option value="receivable">Conta a Receber (Receita)</option>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select
                value={entryForm.categoryId}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, categoryId: e.target.value })
                }
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Descrição" required>
            <Input
              required
              value={entryForm.description}
              onChange={(e) =>
                setEntryForm({ ...entryForm, description: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)" required>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={entryForm.amount}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, amount: e.target.value })
                }
              />
            </Field>
            <Field label="Vencimento" required>
              <Input
                type="date"
                required
                value={entryForm.dueDate}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, dueDate: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Salvar Lançamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Settle */}
      <Modal
        open={Boolean(settleTarget)}
        onClose={() => setSettleTarget(null)}
        title="Registrar Baixa Financeira"
        subtitle={settleTarget?.description}
        size="sm"
      >
        <form onSubmit={handleSettle} className="space-y-3">
          <Field label="Valor pago/recebido (R$)" required>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={settleForm.amount}
              onChange={(e) =>
                setSettleForm({ ...settleForm, amount: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Juros">
              <Input
                type="number"
                step="0.01"
                value={settleForm.interest}
                onChange={(e) =>
                  setSettleForm({ ...settleForm, interest: e.target.value })
                }
              />
            </Field>
            <Field label="Multa">
              <Input
                type="number"
                step="0.01"
                value={settleForm.penalty}
                onChange={(e) =>
                  setSettleForm({ ...settleForm, penalty: e.target.value })
                }
              />
            </Field>
            <Field label="Desconto">
              <Input
                type="number"
                step="0.01"
                value={settleForm.discount}
                onChange={(e) =>
                  setSettleForm({ ...settleForm, discount: e.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Forma de pagamento">
            <Select
              value={settleForm.paymentMethodCode}
              onChange={(e) =>
                setSettleForm({
                  ...settleForm,
                  paymentMethodCode: e.target.value,
                })
              }
            >
              <option value="pix">PIX</option>
              <option value="bank_transfer">Transferência / Boleto</option>
              <option value="cash">Dinheiro</option>
              <option value="debit">Débito</option>
              <option value="credit">Crédito</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSettleTarget(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Confirmar Baixa
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
