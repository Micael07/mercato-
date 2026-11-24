"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const router = useRouter();
  const { toast } = useToast();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não foi possível redefinir a senha.");
        return;
      }
      toast({ type: "success", title: "Senha atualizada com sucesso!" });
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-7 shadow-xs">
      <div className="mb-5 flex items-center gap-3">
        <img
          src="/brand/mercato-login-emblem.svg"
          alt="Mercato"
          className="h-9 w-9"
        />
        <div>
          <h1 className="text-base font-bold text-slate-900">
            Definir nova senha
          </h1>
          <p className="text-xs text-slate-500">
            Crie uma senha forte com ao menos 6 caracteres
          </p>
        </div>
      </div>

      {!token ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Token de redefinição ausente na URL. Solicite um novo link na tela de
          recuperação.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <Field label="Nova senha" required>
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirmar nova senha" required>
            <Input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            Salvar nova senha
          </Button>
        </form>
      )}

      <div className="mt-4 text-center">
        <Link
          href="/login"
          className="text-xs font-medium text-[#0f4c5c] hover:underline"
        >
          Ir para login
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] p-4">
      <Suspense fallback={<div className="text-xs text-slate-500">Carregando...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
