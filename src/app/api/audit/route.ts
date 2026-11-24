import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, auditLogs } from "@/db";
import { requireApiAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "audit.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity")?.trim();
  const action = searchParams.get("action")?.trim();

  const conds = [eq(auditLogs.companyId, ctx.company.id)];
  if (entity && entity !== "all") conds.push(eq(auditLogs.entity, entity));
  if (action && action !== "all") conds.push(eq(auditLogs.action, action));

  const items = await db
    .select()
    .from(auditLogs)
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt))
    .limit(250);

  return NextResponse.json({ items });
}
