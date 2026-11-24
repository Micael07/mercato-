"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui/primitives";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devResetPath, setDevResetPath] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(data.message || "Solicitação processada.");
      if (data.devResetPath) setDevResetPath(data.devResetPath);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-7 shadow-xs">
        <div className="mb-5 flex items-center gap-3">
          <img
            src="/brand/mercato-login-emblem.svg"
            alt="Mercato"
            className="h-9 w-9"
          />
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Recuperar senha
            </h1>
            <p className="text-xs text-slate-500">
              Enviaremos um link seguro para redefinição
            </p>
          </div>
        </div>

        {message && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <p>{message}</p>
            {devResetPath && (
              <p className="mt-2">
                Link (modo dev):{" "}
                <Link
                  href={devResetPath}
                  className="font-semibold underline"
                >
                  Redefinir senha agora
                </Link>
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="E-mail cadastrado" required>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Button type="submit" loading={loading} className="w-full">
            Solicitar redefinição
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Link
            href="/login"
            className="text-xs font-medium text-[#0f4c5c] hover:underline"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    </div>
  );
}
