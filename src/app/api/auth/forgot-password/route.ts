import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidEmail, sha256Hex } from "@/lib/security";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`forgot:ip:${ip}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let devResetPath: string | undefined;

  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await db
      .update(users)
      .set({ resetToken: tokenHash, resetTokenExpiresAt: expiresAt })
      .where(eq(users.id, user.id));

    await recordAudit({
      userId: user.id,
      userName: user.name,
      action: "password_reset_requested",
      entity: "user",
      entityId: user.id,
      ipAddress: ip,
    });

    if (process.env.NODE_ENV !== "production") {
      devResetPath = `/reset-password?token=${rawToken}`;
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição de senha.",
    devResetPath,
  });
}
