"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui/primitives";

export default function ForgotPasswordPage() {
  const [form, setForm] = useState({ email: "", cpf: "", fullName: "", birthDate: "", newPassword: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, confirm: undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Não foi possível recuperar a senha."); return; }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] p-4">
      <div className="w-full max-w-md border border-slate-200 bg-white p-7">
        <h1 className="text-base font-bold text-slate-900">Recuperar senha</h1>
        <p className="mb-5 mt-1 text-xs text-slate-500">Confirme seus dados cadastrados e crie uma nova senha. Não é necessário e-mail.</p>
        {done ? (
          <div className="space-y-4">
            <p role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">Senha alterada. Entre com a nova senha.</p>
            <Link href="/login" className="block text-center text-xs font-semibold text-[#0f4c5c] hover:underline">Ir para o login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            <Field label="E-mail de acesso" required><Input type="email" required value={form.email} onChange={set("email")} /></Field>
            <Field label="CPF" required><Input required inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={set("cpf")} /></Field>
            <Field label="Nome completo" required hint="Maiúsculas, minúsculas e acentos não fazem diferença."><Input required value={form.fullName} onChange={set("fullName")} /></Field>
            <Field label="Data de nascimento" required><Input required type="date" value={form.birthDate} onChange={set("birthDate")} /></Field>
            <Field label="Nova senha" required hint="Mínimo 8 caracteres, com maiúscula, minúscula e número ou símbolo."><Input type="password" required autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} /></Field>
            <Field label="Repita a nova senha" required><Input type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} /></Field>
            <Button type="submit" loading={loading} className="w-full">Redefinir senha</Button>
            <p className="text-[11px] text-slate-400">Não consegue? Peça ao administrador da sua empresa uma senha provisória. Após 5 tentativas erradas a recuperação é bloqueada por 30 minutos.</p>
          </form>
        )}
        {!done && <div className="mt-4 text-center"><Link href="/login" className="text-xs font-medium text-[#0f4c5c] hover:underline">Voltar para o login</Link></div>}
      </div>
    </div>
  );
}
