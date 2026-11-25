import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { hashPassword, requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isPlatformAdminEmail } from "@/lib/platform";
import { computeRecoveryHash } from "@/lib/recovery";
import { generateTempPassword, isUuid, isValidEmail, sanitizeText } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * O ADM da plataforma corrige dados de qualquer usuário.
 * Corpo: { name?, email?, phone?, status?, cpf?, birthDate?, action?: "reset-password" | "force-logout" }
 * - Trocar o nome invalida a recuperação por CPF, a menos que cpf + birthDate venham junto.
 * - A conta do dono da plataforma não pode ter e-mail alterado nem ser bloqueada por aqui.
 */
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

  // Dados de recuperação (CPF e nascimento): só gravados, nunca exibidos.
  if (body.cpf || body.birthDate) {
    const h = computeRecoveryHash({ cpf: body.cpf, fullName: name, birthDate: body.birthDate });
    if (!h) return NextResponse.json({ error: "CPF ou data de nascimento inválidos (informe os dois)." }, { status: 400 });
    patch.recoveryHash = h; patch.recoveryFailedAttempts = 0; patch.recoveryLockedUntil = null;
    after.recovery = "atualizado";
  } else if (patch.name && target.recoveryHash) {
    patch.recoveryHash = null; // o nome faz parte da verificação
    after.recovery = "removido (nome alterado): usuário precisa recadastrar CPF e nascimento";
  }
  if (body.unlockRecovery === true) { patch.recoveryFailedAttempts = 0; patch.recoveryLockedUntil = null; after.recoveryUnlocked = true; }

  if (Object.keys(patch).length === 1) return NextResponse.json({ ok: true, unchanged: true });
  await db.update(users).set(patch).where(eq(users.id, userId));
  await recordAudit({ userId: ctx.user.id, userName: ctx.user.name, action: "platform_user_updated", entity: "user", entityId: userId, previousData: before, newData: after, ...meta });
  return NextResponse.json({ ok: true, recoveryCleared: patch.recoveryHash === null });
}

