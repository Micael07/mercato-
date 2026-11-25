import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, users, companyUsers } from "@/db";
import { hashPassword, requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isPlatformAdminEmail } from "@/lib/platform";
import { generateTempPassword, isUuid } from "@/lib/security";

export const dynamic = "force-dynamic";

/** O administrador da empresa gera uma senha provisória para um colaborador (troca obrigatória no próximo acesso). */
export async function POST(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { membershipId } = await params;
  if (!isUuid(membershipId)) return NextResponse.json({ error: "Vínculo inválido." }, { status: 400 });

  const [target] = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(and(eq(companyUsers.id, membershipId), eq(companyUsers.companyId, ctx.company.id)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  if (target.userId === ctx.user.id) {
    return NextResponse.json({ error: "Para a sua própria senha use Alterar senha." }, { status: 400 });
  }
  if (isPlatformAdminEmail(target.email)) {
    return NextResponse.json({ error: "Este usuário não pode ser redefinido por aqui." }, { status: 403 });
  }

  const tempPassword = generateTempPassword();
  const now = new Date();
  await db
    .update(users)
    .set({ passwordHash: hashPassword(tempPassword), mustChangePassword: true, sessionValidAfter: now, updatedAt: now })
    .where(eq(users.id, target.userId));
  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "company_password_reset",
    entity: "user",
    entityId: target.userId,
    newData: { targetEmail: target.email },
    ...extractRequestMeta(req),
  });
  return NextResponse.json({ ok: true, name: target.name, email: target.email, tempPassword });
}
