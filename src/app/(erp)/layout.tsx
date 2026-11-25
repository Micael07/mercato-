import React from "react";
import { redirect } from "next/navigation";
import { getAuthContext, getRawSessionUser } from "@/lib/auth";
import { SessionProvider, SessionData } from "@/components/session-provider";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAuthContext();
  if (!ctx) {
    // Usuário autenticado sem empresa liberada (licença vencida/bloqueada).
    const raw = await getRawSessionUser();
    redirect(raw ? "/login?motivo=licenca" : "/login");
  }

  if (ctx.user.mustChangePassword) redirect("/trocar-senha");

  const initialSession: SessionData = {
    user: ctx.user,
    isPlatformAdmin: ctx.isPlatformAdmin,
    company: ctx.company,
    establishment: ctx.establishment,
    membership: ctx.membership,
    settings: ctx.settings,
    permissions: Array.from(ctx.permissions),
    availableCompanies: ctx.availableCompanies,
  };

  return (
    <SessionProvider initialSession={initialSession}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
