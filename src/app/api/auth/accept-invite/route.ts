import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, userInvites, users, companyUsers, companies } from "@/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Token não informado." }, { status: 400 });
  }

  const [invite] = await db
    .select({
      id: userInvites.id,
      email: userInvites.email,
      name: userInvites.name,
      roleCode: userInvites.roleCode,
      status: userInvites.status,
      expiresAt: userInvites.expiresAt,
      companyName: companies.tradeName,
    })
    .from(userInvites)
    .innerJoin(companies, eq(userInvites.companyId, companies.id))
    .where(eq(userInvites.token, token))
    .limit(1);

  if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Convite inválido, aceito ou expirado." },
      { status: 404 }
    );
  }

  return NextResponse.json({ invite });
}

export async function POST(req: Request) {
  const body = await req.json();
  const token = String(body?.token ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");

  if (!token) {
    return NextResponse.json({ error: "Token obrigatório." }, { status: 400 });
  }

  const [invite] = await db
    .select()
    .from(userInvites)
    .where(eq(userInvites.token, token))
    .limit(1);

  if (
    !invite ||
    invite.status !== "pending" ||
    invite.expiresAt.getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "Convite inválido ou expirado." },
      { status: 400 }
    );
  }

  const email = invite.email.toLowerCase();

  const result = await db.transaction(async (tx) => {
    let [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      if (!name || password.length < 6) {
        throw new Error("Informe seu nome e senha (mín. 6 caracteres).");
      }
      const [created] = await tx
        .insert(users)
        .values({
          name,
          email,
          passwordHash: hashPassword(password),
          status: "active",
        })
        .returning();
      user = created;
    }

    const [existingLink] = await tx
      .select()
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, invite.companyId),
          eq(companyUsers.userId, user.id)
        )
      )
      .limit(1);

    if (!existingLink) {
      await tx.insert(companyUsers).values({
        companyId: invite.companyId,
        userId: user.id,
        defaultEstablishmentId: invite.establishmentId,
        roleCode: invite.roleCode,
        status: "active",
      });
    } else {
      await tx
        .update(companyUsers)
        .set({ roleCode: invite.roleCode, status: "active", updatedAt: new Date() })
        .where(eq(companyUsers.id, existingLink.id));
    }

    await tx
      .update(userInvites)
      .set({ status: "accepted" })
      .where(eq(userInvites.id, invite.id));

    await recordAudit(
      {
        companyId: invite.companyId,
        establishmentId: invite.establishmentId,
        userId: user.id,
        userName: user.name,
        action: "invite_accepted",
        entity: "user_invite",
        entityId: invite.id,
        newData: { roleCode: invite.roleCode },
      },
      tx as unknown as typeof db
    );

    return user;
  });

  await setSessionCookie({
    userId: result.id,
    companyId: invite.companyId,
    establishmentId: invite.establishmentId,
  });

  return NextResponse.json({ ok: true });
}
