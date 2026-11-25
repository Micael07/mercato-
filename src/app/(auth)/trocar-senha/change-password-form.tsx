"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";

export function ChangePasswordForm({
  userName,
  forced,
  needsRecovery,
}: {
  userName: string;
  forced: boolean;
  needsRecovery: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "", cpf: "", birthDate: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirm) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
          ...(needsRecovery || form.cpf ? { cpf: form.cpf, birthDate: form.birthDate } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não foi possível trocar a senha.");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] p-4">
      <div className="w-full max-w-md border border-slate-200 bg-white p-7">
        <h1 className="text-base font-bold text-slate-900">{forced ? "Crie sua senha" : "Alterar senha"}</h1>
        <p className="mb-5 mt-1 text-xs text-slate-500">
          {forced
            ? `Olá, ${userName}. Sua senha atual é provisória: defina uma nova para continuar.`
            : "Escolha uma nova senha. As outras sessões abertas serão encerradas."}
        </p>
        {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          <Field label={forced ? "Senha provisória" : "Senha atual"} required>
            <Input type="password" required autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} />
          </Field>
          <Field label="Nova senha" required hint="Mínimo 8 caracteres, com maiúscula, minúscula e número ou símbolo.">
            <Input type="password" required autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} />
          </Field>
          <Field label="Repita a nova senha" required>
            <Input type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
          </Field>
          {needsRecovery && (
            <fieldset className="space-y-3 border-t border-slate-100 pt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Para recuperar a senha sem e-mail</legend>
              <p className="text-[11px] text-slate-500">
                Se um dia esquecer a senha, você poderá criar outra informando seu CPF, nome completo ({userName}) e data de nascimento. Esses dados não ficam salvos em texto aberto.
              </p>
              <Field label="CPF" required>
                <Input required inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={set("cpf")} />
              </Field>
              <Field label="Data de nascimento" required>
                <Input required type="date" value={form.birthDate} onChange={set("birthDate")} />
              </Field>
            </fieldset>
          )}
          <Button type="submit" loading={loading} className="w-full">Salvar e continuar</Button>
        </form>
        {!forced && (
          <p className="mt-4 text-center text-xs"><Link href="/" className="font-medium text-[#0f4c5c] hover:underline">Voltar ao sistema</Link></p>
        )}
      </div>
    </div>
  );
}
