import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, savedReports } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { isUuid, sanitizeText } from "@/lib/security";

export const dynamic = "force-dynamic";
const PERIODS = ["today", "7d", "30d", "month", "prev"];

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "reports.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const rows = await db
    .select()
    .from(savedReports)
    .where(and(eq(savedReports.companyId, ctx.company.id), eq(savedReports.userId, ctx.user.id)))
    .orderBy(asc(savedReports.createdAt))
    .limit(30);
  return NextResponse.json({ saved: rows });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "reports.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Requisição inválida." }, { status: 400 }); }
  const name = sanitizeText(body.name, 80);
  const reportType = String(body.reportType ?? "");
  const period = PERIODS.includes(String(body.period)) ? String(body.period) : "30d";
  if (!name || !/^[a-z_]{3,40}$/.test(reportType)) {
    return NextResponse.json({ error: "Informe um nome para o relatório favorito." }, { status: 400 });
  }
  const existing = await db.select({ id: savedReports.id }).from(savedReports)
    .where(and(eq(savedReports.companyId, ctx.company.id), eq(savedReports.userId, ctx.user.id)));
  if (existing.length >= 20) return NextResponse.json({ error: "Limite de 20 favoritos. Remova algum antes." }, { status: 409 });
  const [row] = await db.insert(savedReports).values({ companyId: ctx.company.id, userId: ctx.user.id, name, reportType, period }).returning();
  return NextResponse.json({ saved: row }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireApiAuth(req, "reports.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "Favorito inválido." }, { status: 400 });
  await db.delete(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.companyId, ctx.company.id), eq(savedReports.userId, ctx.user.id)));
  return NextResponse.json({ ok: true });
}
