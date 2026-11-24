"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Database, LogIn } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export function LoginForm({ demoEnabled, registrationEnabled, notice = null }: { demoEnabled: boolean; registrationEnabled: boolean; notice?: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(notice);

  async function signIn(nextEmail = email, nextPassword = password) {
    if (loading) return;
    setError(null); setLoading(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: nextEmail, password: nextPassword }) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Resposta inválida.");
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Confira o e-mail e a senha informados."); return; }
      toast({ type: "success", title: "Acesso autorizado" });
      router.replace("/"); router.refresh();
    } catch { setError("Não foi possível comunicar com o servidor. Aguarde e tente novamente."); }
    finally { setLoading(false); }
  }
  async function loadDemo() {
    setSeeding(true);
    try {
      const response = await fetch("/api/dev/seed", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { toast({ type: "error", title: data.error || "Demonstração indisponível." }); return; }
      toast({ type: "info", title: data.message || "Solicitação concluída." });
      setEmail("admin@mercato.dev"); setPassword("Mercato@2026");
    } catch { toast({ type: "error", title: "Erro de conexão ao carregar a demonstração." }); }
    finally { setSeeding(false); }
  }

  return (
    <main className="login-desktop">
      <div className="w-full max-w-[390px]">
        <div className="login-brand"><Image src="/brand/mercato-symbol.svg" width={34} height={34} alt="" priority /><span>mercato</span></div>
        <section className="login-sheet">
          <h1>Entrar no Mercato</h1><p className="login-subtitle">Informe seus dados para acessar a gestão comercial.</p>
          {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-600">{error}</p>}
          <form onSubmit={(event) => { event.preventDefault(); void signIn(); }} className="space-y-4">
            <Field label="E-mail" htmlFor="login-email" required><Input id="login-email" type="email" autoComplete="username" required maxLength={180} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br" className="!h-9" /></Field>
            <Field label="Senha" htmlFor="login-password" required><Input id="login-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="!h-9" /></Field>
            <div className="flex items-center justify-between gap-3 text-[11px]"><Link href="/forgot-password" className="text-sky-600 hover:underline">Esqueci minha senha</Link>{registrationEnabled && <Link href="/register" className="text-slate-400 hover:text-sky-600">Cadastrar empresa</Link>}</div>
            <Button type="submit" loading={loading} className="w-full !h-9"><LogIn className="h-3.5 w-3.5" />Acessar sistema</Button>
          </form>
          {demoEnabled && <section className="mt-5 space-y-3 border-t border-slate-100 pt-4" aria-label="Demonstração"><p className="text-[10px] text-slate-400">Ambiente de demonstração · não use dados reais</p><div className="grid grid-cols-2 gap-2"><Button variant="outline" size="sm" disabled={loading} onClick={() => void signIn("emporio@mercato.dev", "Mercato@2026")}>Entrar na Empresa B</Button><Button variant="outline" size="sm" disabled={loading} onClick={() => void signIn("admin@mercato.dev", "Mercato@2026")}>Entrar como admin</Button></div><Button variant="outline" size="sm" loading={seeding} onClick={() => void loadDemo()}><Database className="h-3.5 w-3.5" />Carregar base demo</Button></section>}
        </section>
        <p className="login-footnote">Mercato · Gestão comercial e ponto de venda</p>
      </div>
    </main>
  );
}
