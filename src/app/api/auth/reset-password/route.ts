import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { hashPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { sha256Hex, validatePasswordStrength } from "@/lib/security";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`reset:ip:${ip}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const body = await req.json();
  const token = String(body?.token ?? "").trim();
  const password = String(body?.password ?? "");

  if (!token) {
    return NextResponse.json({ error: "Token inválido." }, { status: 400 });
  }

  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.valid) {
    return NextResponse.json({ error: pwdCheck.error }, { status: 400 });
  }

  const tokenHash = sha256Hex(token);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.resetToken, tokenHash))
    .limit(1);

  if (
    !user ||
    !user.resetTokenExpiresAt ||
    user.resetTokenExpiresAt.getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "Link de redefinição expirado ou inválido." },
      { status: 400 }
    );
  }

  await db
    .update(users)
    .set({
      passwordHash: hashPassword(password),
      resetToken: null,
      resetTokenExpiresAt: null,
      sessionValidAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await recordAudit({
    userId: user.id,
    userName: user.name,
    action: "password_reset_completed",
    entity: "user",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true });
}
