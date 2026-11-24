"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Lock,
  Unlock,
  Wallet,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Panel,
  Textarea,
} from "@/components/ui/primitives";
import { ColumnDef, DataTable } from "@/components/ui/data-table";

interface CashRegisterRow {
  id: string;
  userName: string | null;
  terminalName: string;
  status: string;
  openingAmount: number;
  currentBalance: number;
  expectedClosingAmount: number | null;
  countedClosingAmount: number | null;
  differenceAmount: number | null;
  differenceJustification: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface CashMovementRow {
  id: string;
  type: string;
  paymentMethodCode: string | null;
  amount: number;
  description: string;
  userName: string | null;
  createdAt: string;
}

const MOV_LABELS: Record<string, string> = {
  opening: "Abertura",
  supply: "Suprimento",
  bleed: "Sangria",
  sale_in: "Recebimento venda",
  refund_out: "Estorno",
  closing: "Fechamento",
};

export default function CaixaPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();

  const [registers, setRegisters] = useState<CashRegisterRow[]>([]);
  const [activeRegister, setActiveRegister] = useState<CashRegisterRow | null>(
    null
  );
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [openModal, setOpenModal] = useState(false);
  const [terminalName, setTerminalName] = useState("Caixa 01");
  const [openingAmount, setOpeningAmount] = useState("200");

  const [moveModal, setMoveModal] = useState<"supply" | "bleed" | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveDesc, setMoveDesc] = useState("");

  const [closeModal, setCloseModal] = useState(false);
  const [countedClosing, setCountedClosing] = useState("");
  const [diffJustification, setDiffJustification] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closingSummary, setClosingSummary] = useState<Record<
    string,
    number
  > | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cash-registers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRegisters(data.registers ?? []);
        setActiveRegister(data.activeRegister ?? null);
        setMovements(data.movements ?? []);
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
  }, [load, session?.company.id, session?.establishment.id]);

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/cash-registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          terminalName,
          openingAmount: Number(openingAmount) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Caixa aberto!" });
      setOpenModal(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRegister || !moveModal) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/cash-registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: moveModal,
          cashRegisterId: activeRegister.id,
          amount: Number(moveAmount) || 0,
          description: moveDesc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({
        type: "success",
        title:
          moveModal === "supply"
            ? "Suprimento registrado!"
            : "Sangria registrada!",
      });
      setMoveModal(null);
      setMoveAmount("");
      setMoveDesc("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRegister) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cash-registers/${activeRegister.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countedClosingAmount: Number(countedClosing) || 0,
          differenceJustification: diffJustification,
          closingNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: data.error });
        return;
      }
      toast({ type: "success", title: "Caixa fechado e conferido!" });
      setCloseModal(false);
      setClosingSummary(data.summaryByMethod ?? {});
      setDiffJustification("");
      setClosingNotes("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const regCols: ColumnDef<CashRegisterRow>[] = [
    {
      key: "terminalName",
      header: "Terminal",
      render: (r) => <span className="font-semibold">{r.terminalName}</span>,
    },
    {
      key: "userName",
      header: "Operador",
      render: (r) => r.userName || "—",
    },
    {
      key: "openedAt",
      header: "Abertura",
      render: (r) => formatDateTime(r.openedAt),
    },
    {
      key: "closedAt",
      header: "Fechamento",
      render: (r) => (r.closedAt ? formatDateTime(r.closedAt) : "Em aberto"),
    },
    {
      key: "openingAmount",
      header: "Inicial",
      align: "right",
      render: (r) => (
        <span className="font-mono">{formatCurrency(r.openingAmount)}</span>
      ),
    },
    {
      key: "currentBalance",
      header: "Saldo Dinheiro",
      align: "right",
      render: (r) => (
        <span className="font-mono font-semibold">
          {formatCurrency(r.currentBalance)}
        </span>
      ),
    },
    {
      key: "differenceAmount",
      header: "Diferença",
      align: "right",
      render: (r) =>
        r.differenceAmount !== null ? (
          <span
            className={`font-mono font-semibold ${
              Math.abs(r.differenceAmount) >= 0.01
                ? "text-amber-700"
                : "text-emerald-700"
            }`}
          >
            {formatCurrency(r.differenceAmount)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={r.status === "open" ? "success" : "neutral"}>
          {r.status === "open" ? "Aberto" : "Fechado"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Controle de Caixa</h1>
          <p className="text-xs text-slate-500">
            Abertura, suprimentos, sangrias, conferência e histórico de turnos
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!activeRegister && hasPermission("cash.open") && (
            <Button onClick={() => setOpenModal(true)}>
              <Unlock className="h-4 w-4" />
              Abrir Caixa
            </Button>
          )}
          {activeRegister && hasPermission("cash.move") && (
            <>
              <Button
                variant="outline"
                onClick={() => setMoveModal("supply")}
              >
                <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
                Suprimento
              </Button>
              <Button
                variant="outline"
                onClick={() => setMoveModal("bleed")}
              >
                <ArrowDownCircle className="h-4 w-4 text-amber-600" />
                Sangria
              </Button>
            </>
          )}
          {activeRegister && hasPermission("cash.close") && (
            <Button
              variant="secondary"
              onClick={() => {
                setCountedClosing(activeRegister.currentBalance.toFixed(2));
                setCloseModal(true);
              }}
            >
              <Lock className="h-4 w-4" />
              Fechar Caixa
            </Button>
          )}
        </div>
      </div>

      {/* Active cash panel */}
      {activeRegister ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Turno Atual" className="lg:col-span-1">
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Terminal</span>
                <span className="font-semibold text-slate-900">
                  {activeRegister.terminalName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Operador</span>
                <span className="font-medium">{activeRegister.userName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Aberto em</span>
                <span>{formatDateTime(activeRegister.openedAt)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-500">Valor inicial</span>
                <span className="font-mono">
                  {formatCurrency(activeRegister.openingAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">
                  Saldo em gaveta (dinheiro)
                </span>
                <span className="font-mono text-base font-bold text-[#0f4c5c]">
                  {formatCurrency(activeRegister.currentBalance)}
                </span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Movimentações do turno"
            className="lg:col-span-2"
            noPadding
          >
            {movements.length === 0 ? (
              <p className="p-4 text-xs text-slate-400">
                Nenhuma movimentação registrada neste caixa ainda.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Hora</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 text-slate-500">
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {MOV_LABELS[m.type] ?? m.type}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {m.description}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatCurrency(m.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-700" />
            <span>
              Nenhum caixa aberto no estabelecimento atual. Abra um turno para
              operar o PDV.
            </span>
          </div>
        </div>
      )}

      {closingSummary && (
        <Panel
          title="Resumo do último fechamento por forma de pagamento"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setClosingSummary(null)}
            >
              Ocultar
            </Button>
          }
        >
          <div className="flex flex-wrap gap-3">
            {Object.entries(closingSummary).map(([code, val]) => (
              <div
                key={code}
                className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              >
                <p className="uppercase text-slate-500">{code}</p>
                <p className="font-mono font-bold text-slate-900">
                  {formatCurrency(val)}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Histórico de caixas
        </h2>
        <DataTable
          data={registers}
          columns={regCols}
          rowKey={(r) => r.id}
          loading={loading}
        />
      </div>

      {/* Modal: Open Cash */}
      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title="Abertura de Caixa"
        size="sm"
      >
        <form onSubmit={handleOpen} className="space-y-4">
          <Field label="Terminal" required>
            <Input
              required
              value={terminalName}
              onChange={(e) => setTerminalName(e.target.value)}
            />
          </Field>
          <Field label="Fundo de troco inicial (R$)" required>
            <Input
              type="number"
              step="0.01"
              min="0"
              required
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Abrir Caixa
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Supply / Bleed */}
      <Modal
        open={Boolean(moveModal)}
        onClose={() => setMoveModal(null)}
        title={
          moveModal === "supply"
            ? "Registrar Suprimento (Entrada)"
            : "Registrar Sangria (Retirada)"
        }
        size="sm"
      >
        <form onSubmit={handleMove} className="space-y-4">
          <Field label="Valor (R$)" required>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={moveAmount}
              onChange={(e) => setMoveAmount(e.target.value)}
            />
          </Field>
          <Field label="Motivo / Descrição" required>
            <Input
              required
              value={moveDesc}
              onChange={(e) => setMoveDesc(e.target.value)}
              placeholder={
                moveModal === "supply"
                  ? "Ex.: Reforço de troco"
                  : "Ex.: Depósito bancário / pagamento"
              }
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMoveModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Confirmar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Close Cash */}
      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title="Fechamento e Conferência de Caixa"
        size="md"
      >
        {activeRegister && (
          <form onSubmit={handleClose} className="space-y-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
              <p>
                Saldo esperado em gaveta:{" "}
                <strong className="font-mono text-slate-900">
                  {formatCurrency(activeRegister.currentBalance)}
                </strong>
              </p>
            </div>
            <Field label="Valor físico contado em dinheiro (R$)" required>
              <Input
                type="number"
                step="0.01"
                min="0"
                required
                value={countedClosing}
                onChange={(e) => setCountedClosing(e.target.value)}
              />
            </Field>
            {Math.abs(
              (Number(countedClosing) || 0) - activeRegister.currentBalance
            ) >= 0.01 && (
              <Field
                label="Justificativa da diferença"
                required
                hint="Obrigatória quando houver sobra ou falta"
              >
                <Textarea
                  required
                  rows={2}
                  value={diffJustification}
                  onChange={(e) => setDiffJustification(e.target.value)}
                />
              </Field>
            )}
            <Field label="Observações do turno">
              <Textarea
                rows={2}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCloseModal(false)}>
                Voltar
              </Button>
              <Button type="submit" loading={submitting}>
                Encerrar Turno
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
