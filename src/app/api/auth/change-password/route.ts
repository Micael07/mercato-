import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { getRawSessionUser, hashPassword, verifyPassword, setSessionCookie } from "@/lib/auth";
import { recordAudit, extractRequestMeta } from "@/lib/audit";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { validatePasswordStrength } from "@/lib/security";
import { computeRecoveryHash } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/**
 * Troca a senha do usuário logado (obrigatória após senha provisória).
 * Corpo: { currentPassword, newPassword, cpf?, birthDate? }
 * Se o usuário ainda não tem dados de recuperação, cpf e birthDate são obrigatórios;
 * o nome usado na recuperação é o nome cadastrado na conta.
 */
export async function POST(req: Request) {
  const raw = await getRawSessionUser();
  if (!raw) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const { user, payload } = raw;

  const limit = checkRateLimit(`chpw:${user.id}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  checkRateLimit(`chpw:ip:${getClientIp(req)}`, 30, 15 * 60 * 1000);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
  }
  const check = validatePasswordStrength(newPassword);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "A nova senha deve ser diferente da atual." }, { status: 400 });
  }

  let recoveryHash = row.recoveryHash;
  const wantsRecovery = body.cpf !== undefined || body.birthDate !== undefined;
  if (!recoveryHash || wantsRecovery) {
    const h = computeRecoveryHash({ cpf: body.cpf, fullName: row.name, birthDate: body.birthDate });
    if (!h) {
      return NextResponse.json(
        { error: "Informe um CPF válido e a data de nascimento (o nome usado é o cadastrado: " + row.name + ")." },
        { status: 400 }
      );
    }
    recoveryHash = h;
  }

  const now = new Date();
  await db
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      recoveryHash,
      recoveryFailedAttempts: 0,
      recoveryLockedUntil: null,
      passwordChangedAt: now,
      sessionValidAfter: now,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  // a troca encerra as outras sessões; renova a atual
  await setSessionCookie({
    userId: user.id,
    companyId: payload.companyId,
    establishmentId: payload.establishmentId,
  });
  await recordAudit({
    companyId: payload.companyId,
    userId: user.id,
    userName: user.name,
    action: "password_changed",
    entity: "user",
    entityId: user.id,
    ...extractRequestMeta(req),
  });
  return NextResponse.json({ ok: true });
}
