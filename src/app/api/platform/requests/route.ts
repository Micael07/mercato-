import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, userRequests, companies } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Fila global de solicitações de usuário pendentes, de todas as empresas. */
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const requests = await db
    .select({
      id: userRequests.id,
      companyId: userRequests.companyId,
      companyName: companies.tradeName,
      name: userRequests.name,
      email: userRequests.email,
      phone: userRequests.phone,
      roleCode: userRequests.roleCode,
      notes: userRequests.notes,
      requestedByName: userRequests.requestedByName,
      createdAt: userRequests.createdAt,
      maxUsers: companies.maxUsers,
    })
    .from(userRequests)
    .innerJoin(companies, eq(userRequests.companyId, companies.id))
    .where(eq(userRequests.status, "pending"))
    .orderBy(desc(userRequests.createdAt))
    .limit(200);
  return NextResponse.json({ requests });
}
