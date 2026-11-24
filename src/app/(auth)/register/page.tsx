import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (process.env.ALLOW_PUBLIC_REGISTRATION === "false") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-7">
          <h1 className="text-lg font-semibold">Novos cadastros estão fechados</h1>
          <p className="text-sm text-slate-600">Já tem uma conta? Entre normalmente. Para um novo acesso, solicite um convite ao administrador da empresa.</p>
          <Link href="/login" className="inline-flex text-sm font-medium text-[#0f4c5c] underline">Voltar para o login</Link>
        </section>
      </main>
    );
  }
  return <RegisterForm />;
}
