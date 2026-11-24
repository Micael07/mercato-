import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, companyUsers, roleChangeHistory, users } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/security";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "manager", "cashier", "stockist"] as const;
const STATUSES = ["active", "inactive"] as const;

/** Usuários de uma empresa cliente, com perfil e situação. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      roleCode: companyUsers.roleCode,
      status: companyUsers.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, id))
    .orderBy(asc(companyUsers.createdAt));

  return NextResponse.json({ members });
}

/**
 * Altera perfil (admin, gerente, caixa, estoquista) ou bloqueia/reativa um usuário
 * da empresa cliente. O bloqueio vale na hora: sem vínculo ativo, a sessão deixa de funcionar.
 * Corpo: { membershipId, roleCode?, status?, reason? }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  if (!isUuid(body.membershipId)) {
    return NextResponse.json({ error: "Vínculo inválido." }, { status: 400 });
  }
  if (body.roleCode !== undefined && !ROLES.includes(body.roleCode as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }
  if (body.status !== undefined && !STATUSES.includes(body.status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(companyUsers)
    .where(and(eq(companyUsers.id, body.membershipId), eq(companyUsers.companyId, id)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "Usuário não encontrado nesta empresa." }, { status: 404 });

  const newRole = (body.roleCode as string | undefined) ?? target.roleCode;
  const newStatus = (body.status as string | undefined) ?? target.status;

  // A empresa precisa manter ao menos um administrador ativo.
  if (
    target.roleCode === "admin" &&
    target.status === "active" &&
    (newRole !== "admin" || newStatus !== "active")
  ) {
    const admins = await db
      .select({ id: companyUsers.id })
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, id), eq(companyUsers.roleCode, "admin"), eq(companyUsers.status, "active")));
    if (admins.length <= 1) {
      return NextResponse.json(
        { error: "A empresa precisa manter ao menos um administrador ativo. Promova outro usuário antes." },
        { status: 409 }
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(companyUsers)
      .set({ roleCode: newRole, status: newStatus, updatedAt: new Date() })
      .where(eq(companyUsers.id, target.id));
    if (newRole !== target.roleCode) {
      await tx.insert(roleChangeHistory).values({
        companyId: id,
        targetUserId: target.userId,
        changedByUserId: ctx.user.id,
        previousRole: target.roleCode,
        newRole,
        reason: "Alteração pelo administrador da plataforma",
      });
    }
    await recordAudit(
      {
        companyId: id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        action: "platform_member_updated",
        entity: "company_user",
        entityId: target.id,
        previousData: { roleCode: target.roleCode, status: target.status },
        newData: { roleCode: newRole, status: newStatus },
        ...extractRequestMeta(req),
      },
      tx as unknown as typeof db
    );
  });

  return NextResponse.json({ ok: true });
}
