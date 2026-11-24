"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export function RegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", email: "", password: "", tradeName: "", legalName: "", cnpj: "", establishmentName: "Matriz",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Não foi possível criar a conta.");
        return;
      }
      if (data.pending) {
        setDone(data.message || "Cadastro recebido. Aguarde a liberação do acesso.");
        return;
      }
      toast({ type: "success", title: "Conta, empresa e estabelecimento criados." });
      router.replace("/");
      router.refresh();
    } catch {
      setError("Falha de conexão. Aguarde e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="login-desktop">
        <div className="w-full max-w-[390px]">
          <div className="login-brand"><Image src="/brand/mercato-symbol.svg" width={34} height={34} alt="" priority /><span>mercato</span></div>
          <section className="login-sheet" role="status">
            <h1>Cadastro recebido</h1>
            <p className="login-subtitle">{done}</p>
            <p className="mb-5 text-[11px] leading-relaxed text-slate-500">Assim que o acesso for liberado, entre com o e-mail e a senha que você acabou de cadastrar.</p>
            <Link href="/login" className="erp-button erp-button--primary erp-button--md w-full">Ir para o login</Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="login-desktop">
      <div className="w-full max-w-[560px]">
        <div className="login-brand"><Image src="/brand/mercato-symbol.svg" width={34} height={34} alt="" priority /><span>mercato</span></div>
        <section className="login-sheet !w-full">
          <h1>Solicitar acesso ao Mercato</h1>
          <p className="login-subtitle">Cadastre sua empresa. O acesso é liberado após a confirmação do pagamento.</p>
          {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-600">{error}</p>}
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Seu nome completo" htmlFor="register-name" required>
                <Input id="register-name" required maxLength={160} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="E-mail de acesso" htmlFor="register-email" required>
                <Input id="register-email" type="email" required maxLength={180} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </div>
            <Field label="Senha" htmlFor="register-password" required hint="8 a 128 caracteres, com maiúsculas, minúsculas e um número ou símbolo.">
              <Input id="register-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <hr className="border-slate-200" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome fantasia" htmlFor="register-company" required>
                <Input id="register-company" required maxLength={200} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
              </Field>
              <Field label="CNPJ / CPF" htmlFor="register-document" required>
                <Input id="register-document" required maxLength={20} inputMode="numeric" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Razão social" htmlFor="register-legal-name">
                <Input id="register-legal-name" maxLength={200} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Opcional: usa o nome fantasia" />
              </Field>
              <Field label="Primeiro estabelecimento" htmlFor="register-establishment" required>
                <Input id="register-establishment" required maxLength={180} value={form.establishmentName} onChange={(e) => setForm({ ...form, establishmentName: e.target.value })} />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <Link href="/login" className="text-[11px] text-sky-600 hover:underline">Já possui conta? Entrar</Link>
              <Button type="submit" loading={loading}>Solicitar acesso</Button>
            </div>
          </form>
        </section>
        <p className="login-footnote">Mercato · Gestão comercial e ponto de venda</p>
      </div>
    </main>
  );
}
