import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, users, userRequests, companies, auditLogs } from "@/db";
import { hashPassword, requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isPlatformAdminEmail } from "@/lib/platform";
import { computeRecoveryHash, decryptProfile, encryptProfile, formatCpf } from "@/lib/recovery";
import { generateTempPassword, isUuid, isValidEmail, sanitizeText } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * O ADM da plataforma corrige dados de qualquer usuário.
 * Corpo: { name?, email?, phone?, status?, cpf?, birthDate?, action?: "reset-password" | "force-logout" }
 * - Trocar o nome invalida a recuperação por CPF, a menos que cpf + birthDate venham junto.
 * - A conta do dono da plataforma não pode ter e-mail alterado nem ser bloqueada por aqui.
 */
/** Cadastro completo do usuário (inclui CPF e nascimento descriptografados) + origem e histórico. */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { userId } = await params;
  if (!isUuid(userId)) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const profile = decryptProfile(u.profileEnc);
  const [origin] = await db
    .select({
      requestedByName: userRequests.requestedByName,
      decidedByName: userRequests.decidedByName,
      requestedAt: userRequests.createdAt,
      decidedAt: userRequests.decidedAt,
      companyName: companies.tradeName,
    })
    .from(userRequests)
    .innerJoin(companies, eq(userRequests.companyId, companies.id))
    .where(eq(userRequests.createdUserId, userId))
    .limit(1);
  const history = await db
    .select({
      id: auditLogs.id, action: auditLogs.action, userName: auditLogs.userName,
      previousData: auditLogs.previousData, newData: auditLogs.newData, createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entity, "user"), eq(auditLogs.entityId, userId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(30);

  await recordAudit({ userId: auth.ctx.user.id, userName: auth.ctx.user.name, action: "platform_user_profile_viewed", entity: "user", entityId: userId, ...extractRequestMeta(req) });
  return NextResponse.json({
    profile: profile ? { cpf: formatCpf(profile.cpf), birthDate: profile.birthDate } : null,
    profileState: profile ? "ok" : u.recoveryHash ? "unavailable" : "missing",
    createdAt: u.createdAt, updatedAt: u.updatedAt, passwordChangedAt: u.passwordChangedAt, lastLoginAt: u.lastLoginAt,
    origin: origin ?? null, history,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { userId } = await params;
  if (!isUuid(userId)) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  const owner = isPlatformAdminEmail(target.email);
  const now = new Date();
  const meta = extractRequestMeta(req);

  if (body.action === "reset-password") {
    if (owner && target.id !== ctx.user.id) {
      return NextResponse.json({ error: "Conta de administrador da plataforma." }, { status: 403 });
    }
    const tempPassword = generateTempPassword();
    await db
      .update(users)
      .set({ passwordHash: hashPassword(tempPassword), mustChangePassword: true, recoveryFailedAttempts: 0, recoveryLockedUntil: null, sessionValidAfter: now, updatedAt: now })
      .where(eq(users.id, userId));
    await recordAudit({ userId: ctx.user.id, userName: ctx.user.name, action: "platform_user_password_reset", entity: "user", entityId: userId, newData: { targetEmail: target.email }, ...meta });
    return NextResponse.json({ ok: true, email: target.email, name: target.name, tempPassword });
  }
  if (body.action === "force-logout") {
    await db.update(users).set({ sessionValidAfter: now, updatedAt: now }).where(eq(users.id, userId));
    await recordAudit({ userId: ctx.user.id, userName: ctx.user.name, action: "platform_user_logout", entity: "user", entityId: userId, ...meta });
    return NextResponse.json({ ok: true });
  }

  const patch: Partial<typeof users.$inferInsert> = { updatedAt: now };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  const name = body.name === undefined ? target.name : sanitizeText(body.name, 160);
  if (!name || name.split(" ").filter(Boolean).length < 2) {
    return NextResponse.json({ error: "Informe nome e sobrenome." }, { status: 400 });
  }
  if (name !== target.name) { patch.name = name; before.name = target.name; after.name = name; }

  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email !== target.email) {
      if (owner) return NextResponse.json({ error: "O e-mail do administrador da plataforma é definido pela variável PLATFORM_ADMIN_EMAILS." }, { status: 403 });
      if (!isValidEmail(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
      const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (dup) return NextResponse.json({ error: "Já existe usuário com este e-mail." }, { status: 409 });
      patch.email = email; before.email = target.email; after.email = email;
      patch.sessionValidAfter = now; // novo login com o novo e-mail
    }
  }
  if (body.phone !== undefined) {
    const phone = sanitizeText(body.phone, 30) || null;
    if (phone !== target.phone) { patch.phone = phone; before.phone = target.phone; after.phone = phone; }
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "inactive") return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
    if (body.status !== target.status) {
      if (owner || target.id === ctx.user.id) return NextResponse.json({ error: "Esta conta não pode ser bloqueada por aqui." }, { status: 403 });
      patch.status = body.status; before.status = target.status; after.status = body.status;
      patch.sessionValidAfter = now;
    }
  }

  // CPF e nascimento: criptografados no banco e visíveis só ao ADM da plataforma.
  const known = decryptProfile(target.profileEnc);
  if (body.cpf !== undefined || body.birthDate !== undefined) {
    const cpf = body.cpf ? body.cpf : known?.cpf;
    const birthDate = body.birthDate ? body.birthDate : known?.birthDate;
    const h = computeRecoveryHash({ cpf, fullName: name, birthDate });
    const enc = encryptProfile({ cpf, birthDate });
    if (!h || !enc) return NextResponse.json({ error: "CPF ou data de nascimento inválidos." }, { status: 400 });
    patch.recoveryHash = h; patch.profileEnc = enc; patch.recoveryFailedAttempts = 0; patch.recoveryLockedUntil = null;
    after.cpf = "atualizado"; after.birthDate = "atualizado";
  } else if (patch.name && target.recoveryHash) {
    // o nome faz parte da verificação: recalcula quando o cadastro está legível, senão limpa
    const h = known ? computeRecoveryHash({ cpf: known.cpf, fullName: name, birthDate: known.birthDate }) : null;
    patch.recoveryHash = h;
    after.recovery = h ? "recalculado com o novo nome" : "removido (nome alterado): usuário precisa recadastrar CPF e nascimento";
  }
  if (body.unlockRecovery === true) { patch.recoveryFailedAttempts = 0; patch.recoveryLockedUntil = null; after.recoveryUnlocked = true; }

  if (Object.keys(patch).length === 1) return NextResponse.json({ ok: true, unchanged: true });
  await db.update(users).set(patch).where(eq(users.id, userId));
  await recordAudit({ userId: ctx.user.id, userName: ctx.user.name, action: "platform_user_updated", entity: "user", entityId: userId, previousData: before, newData: after, ...meta });
  return NextResponse.json({ ok: true, recoveryCleared: patch.recoveryHash === null });
}

