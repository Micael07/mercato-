import { and, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { companies } from "@/db/schema";

export type LicenseStatus = "pending" | "trial" | "active" | "suspended";
export const LICENSE_STATUSES: LicenseStatus[] = ["pending", "trial", "active", "suspended"];

export const LICENSE_LABELS: Record<LicenseStatus, string> = {
  pending: "Aguardando liberação",
  trial: "Período de teste",
  active: "Ativa",
  suspended: "Bloqueada",
};

export type LicenseState = "ok" | "expiring" | "expired" | "pending" | "suspended";

/** Condição SQL: a licença permite o uso do sistema agora. */
export function licenseValidSql(): SQL {
  return and(
    inArray(companies.licenseStatus, ["active", "trial"]),
    or(isNull(companies.licenseExpiresAt), gt(companies.licenseExpiresAt, sql`now()`))
  ) as SQL;
}

export function evaluateLicense(
  status: string,
  expiresAt: Date | string | null,
  now = new Date()
): { state: LicenseState; daysLeft: number | null } {
  if (status === "pending") return { state: "pending", daysLeft: null };
  if (status === "suspended") return { state: "suspended", daysLeft: null };
  if (!expiresAt) return { state: "ok", daysLeft: null };
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return { state: "expired", daysLeft: 0 };
  const daysLeft = Math.ceil(ms / 86_400_000);
  return { state: daysLeft <= 7 ? "expiring" : "ok", daysLeft };
}

export function licenseBlockedMessage(state: LicenseState): string {
  const contact = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
  const suffix = contact ? ` Contato: ${contact}.` : "";
  if (state === "pending")
    return `Cadastro recebido. O acesso ainda não foi liberado pelo fornecedor do Mercato.${suffix}`;
  if (state === "expired")
    return `A licença desta empresa venceu. Regularize o pagamento para voltar a acessar.${suffix}`;
  return `O acesso desta empresa está bloqueado.${suffix}`;
}

/** Soma dias a partir do maior valor entre hoje e o vencimento atual (renovação sem perder dias). */
export function extendExpiry(current: Date | null, days: number, now = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * 86_400_000);
}
