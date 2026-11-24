import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  users,
  companyUsers,
  userInvites,
  roleChangeHistory,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      roleCode: companyUsers.roleCode,
      maxDiscountPercent: companyUsers.maxDiscountPercent,
      customPermissions: companyUsers.customPermissions,
      status: companyUsers.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: companyUsers.createdAt,
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, ctx.company.id));

  const invites = await db
    .select()
    .from(userInvites)
    .where(eq(userInvites.companyId, ctx.company.id))
    .orderBy(desc(userInvites.createdAt))
    .limit(50);

  const history = await db
    .select({
      id: roleChangeHistory.id,
      previousRole: roleChangeHistory.previousRole,
      newRole: roleChangeHistory.newRole,
      reason: roleChangeHistory.reason,
      createdAt: roleChangeHistory.createdAt,
      targetName: users.name,
    })
    .from(roleChangeHistory)
    .leftJoin(users, eq(roleChangeHistory.targetUserId, users.id))
    .where(eq(roleChangeHistory.companyId, ctx.company.id))
    .orderBy(desc(roleChangeHistory.createdAt))
    .limit(30);

  return NextResponse.json({
    members: members.map((m) => ({
      ...m,
      maxDiscountPercent: toNumber(m.maxDiscountPercent),
    })),
    invites,
    history,
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = String(body?.name ?? "").trim();
  const roleCode = String(body?.roleCode ?? "cashier");

  if (!email || !["admin", "manager", "cashier", "stockist"].includes(roleCode)) {
    return NextResponse.json(
      { error: "Informe e-mail e perfil válidos." },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);

  const [invite] = await db
    .insert(userInvites)
    .values({
      companyId: ctx.company.id,
      establishmentId: body?.establishmentId || ctx.establishment.id,
      email,
      name: name || null,
      roleCode,
      token,
      invitedBy: ctx.user.id,
      status: "pending",
      expiresAt,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "user_invited",
    entity: "user_invite",
    entityId: invite.id,
    newData: { email, roleCode },
  });

  return NextResponse.json(
    {
      invite,
      acceptUrl: `/accept-invite?token=${token}`,
    },
    { status: 201 }
  );
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const membershipId = String(body?.membershipId ?? "");
  if (!membershipId) {
    return NextResponse.json({ error: "Vínculo obrigatório." }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.id, membershipId),
        eq(companyUsers.companyId, ctx.company.id)
      )
    )
    .limit(1);

  if (!target) {
    return NextResponse.json({ error: "Vínculo não encontrado." }, { status: 404 });
  }

  const newRole = body?.roleCode ? String(body.roleCode) : target.roleCode;
  const newStatus = body?.status ? String(body.status) : target.status;

  // Guardrail: never remove or deactivate the last active administrator!
  if (
    target.roleCode === "admin" &&
    target.status === "active" &&
    (newRole !== "admin" || newStatus !== "active")
  ) {
    const activeAdmins = await db
      .select({ id: companyUsers.id })
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, ctx.company.id),
          eq(companyUsers.roleCode, "admin"),
          eq(companyUsers.status, "active")
        )
      );

    if (activeAdmins.length <= 1) {
      return NextResponse.json(
        {
          error:
            "Operação bloqueada: a empresa precisa manter ao menos um administrador ativo.",
        },
        { status: 409 }
      );
    }
  }

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companyUsers)
      .set({
        roleCode: newRole,
        status: newStatus,
        maxDiscountPercent:
          body?.maxDiscountPercent !== undefined
            ? toNumber(body.maxDiscountPercent).toFixed(2)
            : target.maxDiscountPercent,
        customPermissions:
          body?.customPermissions !== undefined
            ? body.customPermissions
            : target.customPermissions,
        updatedAt: new Date(),
      })
      .where(eq(companyUsers.id, target.id))
      .returning();

    if (newRole !== target.roleCode) {
      await tx.insert(roleChangeHistory).values({
        companyId: ctx.company.id,
        targetUserId: target.userId,
        changedByUserId: ctx.user.id,
        previousRole: target.roleCode,
        newRole,
        reason: body?.reason ? String(body.reason) : "Alteração administrativa",
      });
    }

    await recordAudit(
      {
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        action: "user_membership_updated",
        entity: "company_user",
        entityId: target.id,
        previousData: { roleCode: target.roleCode, status: target.status },
        newData: { roleCode: newRole, status: newStatus },
      },
      tx as unknown as typeof db
    );

    return [row];
  });

  return NextResponse.json({ member: updated });
}
