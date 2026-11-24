"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const router = useRouter();
  const { toast } = useToast();

  const [invite, setInvite] = useState<{
    email: string;
    name: string | null;
    roleCode: string;
    companyName: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() =>
    token ? null : "Token de convite não informado."
  );
  const [loading, setLoading] = useState(() => Boolean(token));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!active) return;
        if (!ok) {
          setError(d.error || "Convite inválido.");
        } else {
          setInvite(d.invite);
          setName(d.invite.name || "");
        }
      })
      .catch(() => {
        if (active) setError("Erro ao validar convite.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Não foi possível aceitar o convite.");
        return;
      }
      toast({ type: "success", title: "Convite aceito! Bem-vindo ao Mercato." });
      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
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
          <h1 className="text-base font-bold text-slate-900">Aceitar convite</h1>
          <p className="text-xs text-slate-500">
            Vincule sua conta à equipe no Mercato
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Validando convite...</p>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      ) : invite ? (
        <form onSubmit={handleAccept} className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              Empresa: <strong>{invite.companyName}</strong>
            </p>
            <p>
              E-mail convidado: <strong>{invite.email}</strong>
            </p>
            <p>
              Perfil atribuído: <strong className="uppercase">{invite.roleCode}</strong>
            </p>
          </div>
          <Field label="Seu nome" required>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Defina sua senha" required>
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={submitting} className="w-full">
            Aceitar e entrar
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] p-4">
      <Suspense fallback={<div className="text-xs text-slate-500">Carregando...</div>}>
        <AcceptInviteForm />
      </Suspense>
    </div>
  );
}
