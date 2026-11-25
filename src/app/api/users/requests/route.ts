import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, userRequests, users, companyUsers } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { isValidEmail, sanitizeText } from "@/lib/security";
import { getSeats, ROLE_CODES } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Solicitações de usuário da empresa + vagas. */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const requests = await db
    .select()
    .from(userRequests)
    .where(eq(userRequests.companyId, ctx.company.id))
    .orderBy(desc(userRequests.createdAt))
    .limit(100);
  return NextResponse.json({ requests, seats: await getSeats(ctx.company.id) });
}

/** O administrador da empresa informa os dados de quem quer autorizar. */
export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const name = sanitizeText(body.name, 160);
  const email = String(body.email ?? "").trim().toLowerCase();
  const roleCode = String(body.roleCode ?? "cashier");
  if (!name || !isValidEmail(email) || !ROLE_CODES.includes(roleCode as (typeof ROLE_CODES)[number])) {
    return NextResponse.json({ error: "Informe nome, e-mail válido e perfil." }, { status: 400 });
  }

  const [dupUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (dupUser) return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
  const [dupReq] = await db
    .select({ id: userRequests.id })
    .from(userRequests)
    .where(
      and(
        eq(userRequests.companyId, ctx.company.id),
        eq(userRequests.status, "pending"),
        sql`lower(${userRequests.email}) = ${email}`
      )
    )
    .limit(1);
  if (dupReq) return NextResponse.json({ error: "Já existe uma solicitação pendente para este e-mail." }, { status: 409 });

  const seats = await getSeats(ctx.company.id);
  if (seats.active + seats.pending >= seats.max) {
    return NextResponse.json(
      {
        error: `Limite de usuários atingido (${seats.active} ativos + ${seats.pending} pendentes de ${seats.max}). Fale com o administrador da plataforma para aumentar o limite.`,
      },
      { status: 409 }
    );
  }

  const [created] = await db
    .insert(userRequests)
    .values({
      companyId: ctx.company.id,
      name,
      email,
      phone: sanitizeText(body.phone, 30) || null,
      roleCode,
      notes: sanitizeText(body.notes, 500) || null,
      requestedBy: ctx.user.id,
      requestedByName: ctx.user.name,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "user_requested",
    entity: "user_request",
    entityId: created.id,
    newData: { email, roleCode },
  });
  return NextResponse.json({ request: created, seats: await getSeats(ctx.company.id) }, { status: 201 });
}
