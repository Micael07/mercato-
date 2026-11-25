import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db, users, companyUsers, companies } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { isPlatformAdminEmail } from "@/lib/platform";

export const dynamic = "force-dynamic";

/** Todos os usuários de todas as empresas, com seus vínculos. Filtros no cliente (até 2000 usuários). */
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      recoveryHash: users.recoveryHash,
      recoveryLockedUntil: users.recoveryLockedUntil,
      lastLoginAt: users.lastLoginAt,
      passwordChangedAt: users.passwordChangedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(2000);

  const links = await db
    .select({
      userId: companyUsers.userId,
      membershipId: companyUsers.id,
      companyId: companyUsers.companyId,
      companyName: companies.tradeName,
      roleCode: companyUsers.roleCode,
      status: companyUsers.status,
    })
    .from(companyUsers)
    .innerJoin(companies, eq(companyUsers.companyId, companies.id))
    .orderBy(asc(companies.tradeName));

  const byUser = new Map<string, typeof links>();
  for (const l of links) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);

  return NextResponse.json({
    users: rows.map(({ recoveryHash, ...u }) => ({
      ...u,
      recoveryConfigured: !!recoveryHash,
      isPlatformAdmin: isPlatformAdminEmail(u.email),
      memberships: (byUser.get(u.id) ?? []).map(({ userId, ...m }) => (void userId, m)),
    })),
  });
}
