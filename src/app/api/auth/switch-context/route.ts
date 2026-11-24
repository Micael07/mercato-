import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, companyUsers, companies, establishments } from "@/db";
import { licenseValidSql } from "@/lib/license";
import { getAuthContext, setSessionCookie } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const body = await req.json();
  const targetCompanyId = String(body?.companyId ?? ctx.company.id);
  const requestedEstId = body?.establishmentId ? String(body.establishmentId) : null;

  // Verify user actually belongs to targetCompanyId on server!
  const [row] = await db
    .select({ membership: companyUsers })
    .from(companyUsers)
    .innerJoin(companies, eq(companyUsers.companyId, companies.id))
    .where(
      and(
        eq(companyUsers.userId, ctx.user.id),
        eq(companyUsers.companyId, targetCompanyId),
        eq(companyUsers.status, "active"),
        eq(companies.status, "active"),
        ctx.isPlatformAdmin ? undefined : licenseValidSql()
      )
    )
    .limit(1);

  const membership = row?.membership;
  if (!membership) {
    const meta = extractRequestMeta(req);
    await recordAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: "unauthorized_company_switch",
      entity: "company",
      entityId: targetCompanyId,
      ...meta,
    });
    return NextResponse.json(
      { error: "Você não possui acesso à empresa solicitada." },
      { status: 403 }
    );
  }

  const companyEsts = await db
    .select()
    .from(establishments)
    .where(
      and(
        eq(establishments.companyId, targetCompanyId),
        eq(establishments.status, "active")
      )
    );

  if (companyEsts.length === 0) {
    return NextResponse.json(
      { error: "Empresa não possui estabelecimento ativo." },
      { status: 400 }
    );
  }

  const targetEst =
    (requestedEstId && companyEsts.find((e) => e.id === requestedEstId)) ||
    companyEsts.find((e) => e.id === membership.defaultEstablishmentId) ||
    companyEsts.find((e) => e.isDefault) ||
    companyEsts[0];

  await setSessionCookie({
    userId: ctx.user.id,
    companyId: targetCompanyId,
    establishmentId: targetEst.id,
  });

  await recordAudit({
    companyId: targetCompanyId,
    establishmentId: targetEst.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "context_switched",
    entity: "company",
    entityId: targetCompanyId,
    newData: { establishmentId: targetEst.id },
  });

  return NextResponse.json({
    ok: true,
    companyId: targetCompanyId,
    establishmentId: targetEst.id,
  });
}
