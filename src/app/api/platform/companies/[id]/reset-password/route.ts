import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, companyUsers, users } from "@/db";
import { hashPassword, requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { generateTempPassword, isUuid } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * O Mercato não envia e-mails: quando o cliente esquece a senha, o administrador
 * da plataforma gera uma senha provisória (exibida uma única vez) e encerra as
 * sessões abertas daquele usuário.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* corpo opcional */
  }
  const targetUserId = isUuid(body.userId) ? body.userId : null;

  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, roleCode: companyUsers.roleCode })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(and(eq(companyUsers.companyId, id), eq(companyUsers.status, "active")))
    .orderBy(asc(companyUsers.createdAt));

  const target = targetUserId
    ? members.find((m) => m.userId === targetUserId)
    : members.find((m) => m.roleCode === "admin") ?? members[0];
  if (!target) return NextResponse.json({ error: "Usuário não encontrado nesta empresa." }, { status: 404 });

  const tempPassword = generateTempPassword();
  await db
    .update(users)
    .set({
      passwordHash: hashPassword(tempPassword),
      resetToken: null,
      resetTokenExpiresAt: null,
      mustChangePassword: true,
      sessionValidAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.userId));

  await recordAudit({
    companyId: id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "platform_password_reset",
    entity: "user",
    entityId: target.userId,
    newData: { targetEmail: target.email },
    ...extractRequestMeta(req),
  });

  return NextResponse.json({ ok: true, name: target.name, email: target.email, tempPassword });
}
