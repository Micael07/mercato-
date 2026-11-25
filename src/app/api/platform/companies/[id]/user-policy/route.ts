import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, companies } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/security";
import { getSeats } from "@/lib/team";

export const dynamic = "force-dynamic";

/** ADM da plataforma define o limite de usuários e quem autoriza novos. Corpo: { maxUsers?, mode? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const before = await getSeats(id);
  const maxUsers = body.maxUsers === undefined ? before.max : Number(body.maxUsers);
  const mode = body.mode === undefined ? before.mode : String(body.mode);
  if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 1000) {
    return NextResponse.json({ error: "Limite deve ser um número de 1 a 1000." }, { status: 400 });
  }
  if (mode !== "platform" && mode !== "company") {
    return NextResponse.json({ error: "Modo de autorização inválido." }, { status: 400 });
  }
  if (maxUsers < before.active) {
    return NextResponse.json(
      { error: `A empresa já tem ${before.active} usuários ativos. Bloqueie alguns antes de reduzir o limite.` },
      { status: 409 }
    );
  }
  await db
    .update(companies)
    .set({ maxUsers, userApprovalMode: mode, updatedAt: new Date() })
    .where(eq(companies.id, id));
  await recordAudit({
    companyId: id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "platform_user_policy_updated",
    entity: "company",
    entityId: id,
    previousData: { maxUsers: before.max, mode: before.mode },
    newData: { maxUsers, mode },
    ...extractRequestMeta(req),
  });
  return NextResponse.json({ ok: true, seats: await getSeats(id) });
}
