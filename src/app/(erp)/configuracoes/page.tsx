"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Save, UploadCloud } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import {
  Button,
  Field,
  Input,
  Panel,
  Select,
  Textarea,
} from "@/components/ui/primitives";

export default function ConfiguracoesPage() {
  const { session, refreshSession } = useSession();
  const { toast } = useToast();

  const [form, setForm] = useState({
    allowNegativeStock: false,
    allowDuplicateBarcode: false,
    maxDiscountPercent: "10.00",
    managerMaxDiscountPercent: "25.00",
    decimalPlaces: "2",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    dateFormat: "dd/MM/yyyy",
    requireOpenCashRegister: true,
    singleOpenCashPerOperator: true,
    receiptFooter: "",
    thermalPrintEnabled: true,
    nextSaleNumber: "1001",
    nextPurchaseNumber: "101",
  });
  const [paymentMethods, setPaymentMethods] = useState<
    Array<{
      id: string;
      name: string;
      code: string;
      feePercent: number;
      maxInstallments: number;
      isActive: boolean;
    }>
  >([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [sRes, pmRes] = await Promise.all([
      fetch("/api/settings"),
      fetch("/api/payment-methods"),
    ]);
    if (sRes.ok) {
      const s = (await sRes.json()).settings;
      if (s) {
        setForm({
          allowNegativeStock: Boolean(s.allowNegativeStock),
          allowDuplicateBarcode: Boolean(s.allowDuplicateBarcode),
          maxDiscountPercent: String(s.maxDiscountPercent ?? "10.00"),
          managerMaxDiscountPercent: String(
            s.managerMaxDiscountPercent ?? "25.00"
          ),
          decimalPlaces: String(s.decimalPlaces ?? 2),
          currency: s.currency ?? "BRL",
          timezone: s.timezone ?? "America/Sao_Paulo",
          dateFormat: s.dateFormat ?? "dd/MM/yyyy",
          requireOpenCashRegister: Boolean(s.requireOpenCashRegister),
          singleOpenCashPerOperator: Boolean(s.singleOpenCashPerOperator),
          receiptFooter: s.receiptFooter ?? "",
          thermalPrintEnabled: Boolean(s.thermalPrintEnabled),
          nextSaleNumber: String(s.nextSaleNumber ?? 1001),
          nextPurchaseNumber: String(s.nextPurchaseNumber ?? 101),
        });
      }
    }
    if (pmRes.ok) {
      setPaymentMethods((await pmRes.json()).items ?? []);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load, session?.company.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          maxDiscountPercent: Number(form.maxDiscountPercent),
          managerMaxDiscountPercent: Number(form.managerMaxDiscountPercent),
          decimalPlaces: Number(form.decimalPlaces),
          nextSaleNumber: Number(form.nextSaleNumber),
          nextPurchaseNumber: Number(form.nextPurchaseNumber),
        }),
      });
      if (res.ok) {
        toast({
          type: "success",
          title: "Configurações salvas e registradas na auditoria!",
        });
        await refreshSession();
      } else {
        toast({ type: "error", title: "Erro ao salvar configurações." });
      }
    } finally {
      setSaving(false);
    }
  };

  const togglePm = async (id: string, isActive: boolean) => {
    const res = await fetch("/api/payment-methods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
    if (res.ok) {
      setPaymentMethods((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isActive } : m))
      );
      toast({ type: "success", title: "Forma de pagamento atualizada." });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Configurações</h1>
          <p className="text-xs text-slate-500">
            Regras operacionais de estoque, caixa, descontos, impressão e
            numeração para {session?.company.tradeName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session?.membership.roleCode === "admin" && session.permissions.includes("settings.manage") && (
            <Link href="/configuracoes/publicacao" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c5c]">
              <UploadCloud className="h-4 w-4" />
              Publicação e diagnóstico
            </Link>
          )}
          <Button type="submit" form="settings-form" loading={saving}>
            <Save className="h-4 w-4" />
            Salvar Alterações
          </Button>
        </div>
      </div>

      <form
        id="settings-form"
        onSubmit={handleSave}
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <Panel title="Estoque e Catálogo">
          <div className="space-y-3 text-xs">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.allowNegativeStock}
                onChange={(e) =>
                  setForm({ ...form, allowNegativeStock: e.target.checked })
                }
                className="mt-0.5"
              />
              <span>
                <strong className="block text-slate-900">
                  Permitir estoque negativo
                </strong>
                <span className="text-slate-500">
                  Quando desmarcado, o PDV e saídas manuais bloqueiam vendas sem
                  saldo disponível.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.allowDuplicateBarcode}
                onChange={(e) =>
                  setForm({ ...form, allowDuplicateBarcode: e.target.checked })
                }
                className="mt-0.5"
              />
              <span>
                <strong className="block text-slate-900">
                  Permitir código de barras repetido na mesma empresa
                </strong>
                <span className="text-slate-500">
                  Por padrão, códigos de barras são únicos dentro da mesma empresa.
                </span>
              </span>
            </label>
          </div>
        </Panel>

        <Panel title="PDV, Caixa e Limites de Desconto">
          <div className="space-y-3 text-xs">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.requireOpenCashRegister}
                onChange={(e) =>
                  setForm({
                    ...form,
                    requireOpenCashRegister: e.target.checked,
                  })
                }
                className="mt-0.5"
              />
              <span>
                <strong className="block text-slate-900">
                  Exigir caixa aberto para vender no PDV
                </strong>
                <span className="text-slate-500">
                  Bloqueia finalização de vendas quando não houver turno aberto.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.singleOpenCashPerOperator}
                onChange={(e) =>
                  setForm({
                    ...form,
                    singleOpenCashPerOperator: e.target.checked,
                  })
                }
                className="mt-0.5"
              />
              <span>
                <strong className="block text-slate-900">
                  Somente um caixa aberto por operador
                </strong>
                <span className="text-slate-500">
                  Evita múltiplos turnos simultâneos abertos pelo mesmo usuário.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Desconto máx. Operador (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.maxDiscountPercent}
                  onChange={(e) =>
                    setForm({ ...form, maxDiscountPercent: e.target.value })
                  }
                />
              </Field>
              <Field label="Desconto máx. Gerente (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.managerMaxDiscountPercent}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      managerMaxDiscountPercent: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel title="Impressão, Comprovante e Numeração">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-800">
              <input
                type="checkbox"
                checked={form.thermalPrintEnabled}
                onChange={(e) =>
                  setForm({ ...form, thermalPrintEnabled: e.target.checked })
                }
              />
              Habilitar layout térmico 80mm para comprovantes
            </label>
            <Field label="Rodapé do comprovante">
              <Textarea
                rows={2}
                value={form.receiptFooter}
                onChange={(e) =>
                  setForm({ ...form, receiptFooter: e.target.value })
                }
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Próx. Nº Venda">
                <Input
                  type="number"
                  value={form.nextSaleNumber}
                  onChange={(e) =>
                    setForm({ ...form, nextSaleNumber: e.target.value })
                  }
                />
              </Field>
              <Field label="Próx. Nº Compra">
                <Input
                  type="number"
                  value={form.nextPurchaseNumber}
                  onChange={(e) =>
                    setForm({ ...form, nextPurchaseNumber: e.target.value })
                  }
                />
              </Field>
              <Field label="Casas Decimais">
                <Select
                  value={form.decimalPlaces}
                  onChange={(e) =>
                    setForm({ ...form, decimalPlaces: e.target.value })
                  }
                >
                  <option value="2">2 casas</option>
                  <option value="3">3 casas</option>
                </Select>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel title="Backup dos seus dados">
          <p className="mb-3 text-xs text-slate-600">
            Baixe uma cópia completa dos dados da empresa (produtos, estoque, vendas, compras, financeiro, caixa, clientes e usuários) em planilhas CSV dentro de um arquivo ZIP. Senhas nunca fazem parte do arquivo. Guarde em local seguro.
          </p>
          <a href="/api/company/export" download className="erp-button erp-button--outline erp-button--md inline-flex items-center">
            Baixar backup completo (ZIP)
          </a>
        </Panel>

        <Panel title="Formas de Pagamento Ativas" noPadding>
          <ul className="divide-y divide-slate-100 text-xs">
            {paymentMethods.map((pm) => (
              <li
                key={pm.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="font-semibold text-slate-900">{pm.name}</p>
                  <p className="font-mono text-[10px] text-slate-500">
                    {pm.code} · Taxa {pm.feePercent}% · Máx {pm.maxInstallments}x
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={pm.isActive}
                  onChange={(e) => togglePm(pm.id, e.target.checked)}
                  aria-label={`Ativar ${pm.name}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      </form>
    </div>
  );
}
