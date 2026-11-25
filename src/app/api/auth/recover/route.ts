import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { hashPassword } from "@/lib/auth";
import { recordAudit, extractRequestMeta } from "@/lib/audit";
import { isPlatformAdminEmail } from "@/lib/platform";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { validatePasswordStrength } from "@/lib/security";
import {
  RECOVERY_LOCK_MINUTES,
  RECOVERY_MAX_ATTEMPTS,
  computeRecoveryHash,
  recoveryMatches,
} from "@/lib/recovery";

export const dynamic = "force-dynamic";

const FAIL = "Os dados não conferem. Confira e-mail, CPF, nome completo e data de nascimento.";

/**
 * Recuperação de senha sem e-mail.
 * Corpo: { email, cpf, fullName, birthDate, newPassword }
 * Proteções: e-mail obrigatório (identifica a conta), limite por IP e por conta,
 * bloqueio de 30 min após 5 erros, mensagem única para qualquer falha,
 * conta do dono da plataforma excluída, auditoria e encerramento das sessões abertas.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`recover:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const newPassword = String(body.newPassword ?? "");
  if (!email) return NextResponse.json({ error: FAIL }, { status: 400 });

  const check = validatePasswordStrength(newPassword);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const emailLimit = checkRateLimit(`recover:email:${email}`, 10, 60 * 60 * 1000);
  if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds);

  const meta = extractRequestMeta(req);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const candidate = computeRecoveryHash({ cpf: body.cpf, fullName: body.fullName, birthDate: body.birthDate });

  const eligible = !!user && user.status === "active" && !isPlatformAdminEmail(user.email) && !!user.recoveryHash;
  if (eligible && user.recoveryLockedUntil && user.recoveryLockedUntil.getTime() > Date.now()) {
    return NextResponse.json(
      { error: "Recuperação bloqueada por excesso de tentativas. Tente mais tarde ou peça ao administrador uma senha provisória." },
      { status: 429 }
    );
  }

  if (!eligible || !recoveryMatches(user.recoveryHash, candidate)) {
    if (eligible) {
      const attempts = user.recoveryFailedAttempts + 1;
      const lock = attempts >= RECOVERY_MAX_ATTEMPTS;
      await db
        .update(users)
        .set({
          recoveryFailedAttempts: lock ? 0 : attempts,
          recoveryLockedUntil: lock ? new Date(Date.now() + RECOVERY_LOCK_MINUTES * 60 * 1000) : user.recoveryLockedUntil,
        })
        .where(eq(users.id, user.id));
    }
    await recordAudit({ userId: user?.id ?? null, action: "password_recovery_failed", entity: "auth", newData: { email }, ...meta });
    return NextResponse.json({ error: FAIL }, { status: 400 });
  }

  const now = new Date();
  await db
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      recoveryFailedAttempts: 0,
      recoveryLockedUntil: null,
      resetToken: null,
      resetTokenExpiresAt: null,
      passwordChangedAt: now,
      sessionValidAfter: now,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));
  await recordAudit({ userId: user.id, userName: user.name, action: "password_recovered", entity: "user", entityId: user.id, ...meta });
  return NextResponse.json({ ok: true });
}
