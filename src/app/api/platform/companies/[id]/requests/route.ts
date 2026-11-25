import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, userRequests } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isUuid, sanitizeText } from "@/lib/security";
import { approveRequest, getSeats } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const requests = await db
    .select()
    .from(userRequests)
    .where(eq(userRequests.companyId, id))
    .orderBy(desc(userRequests.createdAt))
    .limit(100);
  return NextResponse.json({ requests, seats: await getSeats(id) });
}

/** Corpo: { requestId, action: "approve" | "reject", note? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  if (!isUuid(id) || !isUuid(body.requestId)) {
    return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  }
  const decider = { id: ctx.user.id, name: ctx.user.name };
  const meta = extractRequestMeta(req);

  if (body.action === "approve") {
    const r = await approveRequest(id, body.requestId, decider);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await recordAudit({
      companyId: id, userId: ctx.user.id, userName: ctx.user.name,
      action: "platform_user_request_approved", entity: "user_request", entityId: body.requestId,
      newData: { email: r.email }, ...meta,
    });
    return NextResponse.json({ ok: true, email: r.email, tempPassword: r.tempPassword });
  }
  if (body.action === "reject") {
    const [row] = await db
      .update(userRequests)
      .set({
        status: "rejected", decidedBy: decider.id, decidedByName: decider.name,
        decidedAt: new Date(), decisionNote: sanitizeText(body.note, 300) || null,
      })
      .where(and(eq(userRequests.id, body.requestId), eq(userRequests.companyId, id), eq(userRequests.status, "pending")))
      .returning();
    if (!row) return NextResponse.json({ error: "Solicitação não encontrada ou já decidida." }, { status: 404 });
    await recordAudit({
      companyId: id, userId: ctx.user.id, userName: ctx.user.name,
      action: "platform_user_request_rejected", entity: "user_request", entityId: body.requestId, ...meta,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
