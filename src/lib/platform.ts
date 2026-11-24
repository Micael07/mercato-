/**
 * Administrador da plataforma (dono do Mercato): único que libera, renova e
 * bloqueia o acesso das empresas clientes. Definido por variável de ambiente
 * no servidor — não existe tela ou API pública para se tornar administrador.
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().includes(email.trim().toLowerCase());
}
