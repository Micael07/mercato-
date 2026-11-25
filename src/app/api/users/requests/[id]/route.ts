import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, userRequests } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { isUuid, sanitizeText } from "@/lib/security";
import { approveRequest, getSeats } from "@/lib/team";

export const dynamic = "force-dynamic";

/**
 * Decide uma solicitação. Corpo: { action: "approve" | "reject" | "cancel", note? }
 * Aprovar só é permitido ao administrador da empresa se o ADM da plataforma liberou
 * (modo "company"); rejeitar/cancelar sempre pode.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const note = sanitizeText(body.note, 300) || null;
  const decider = { id: ctx.user.id, name: ctx.user.name };

  if (action === "approve") {
    const seats = await getSeats(ctx.company.id);
    if (seats.mode !== "company") {
      return NextResponse.json(
        { error: "A autorização de novos usuários desta empresa é feita pelo administrador da plataforma." },
        { status: 403 }
      );
    }
    const r = await approveRequest(ctx.company.id, id, decider);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await recordAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: "user_request_approved",
      entity: "user_request",
      entityId: id,
      newData: { email: r.email },
    });
    return NextResponse.json({ ok: true, email: r.email, tempPassword: r.tempPassword });
  }

  if (action === "reject" || action === "cancel") {
    const [row] = await db
      .update(userRequests)
      .set({
        status: action === "reject" ? "rejected" : "cancelled",
        decidedBy: decider.id,
        decidedByName: decider.name,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(and(eq(userRequests.id, id), eq(userRequests.companyId, ctx.company.id), eq(userRequests.status, "pending")))
      .returning();
    if (!row) return NextResponse.json({ error: "Solicitação não encontrada ou já decidida." }, { status: 404 });
    await recordAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: `user_request_${action}ed`,
      entity: "user_request",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
