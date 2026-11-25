import { NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, companies, companyUsers, establishments, licenseEvents, users } from "@/db";
import { hashPassword, requirePlatformAdmin } from "@/lib/auth";
import { recordAudit, extractRequestMeta } from "@/lib/audit";
import { evaluateLicense, extendExpiry } from "@/lib/license";
import { generateTempPassword, isValidEmail, sanitizeText } from "@/lib/security";
import { seedCompanyDefaults } from "@/lib/services/provision";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;

  const rows = await db.select().from(companies).orderBy(asc(companies.tradeName));
  const ids = rows.map((c) => c.id);

  const members = ids.length
    ? await db
        .select({
          companyId: companyUsers.companyId,
          roleCode: companyUsers.roleCode,
          status: companyUsers.status,
          userId: users.id,
          name: users.name,
          email: users.email,
          lastLoginAt: users.lastLoginAt,
          createdAt: companyUsers.createdAt,
        })
        .from(companyUsers)
        .innerJoin(users, eq(companyUsers.userId, users.id))
        .where(inArray(companyUsers.companyId, ids))
        .orderBy(asc(companyUsers.createdAt))
    : [];

  const estCounts = ids.length
    ? await db
        .select({ companyId: establishments.companyId, total: sql<number>`count(*)::int` })
        .from(establishments)
        .where(and(inArray(establishments.companyId, ids), eq(establishments.status, "active")))
        .groupBy(establishments.companyId)
    : [];

  const list = rows.map((c) => {
    const m = members.filter((x) => x.companyId === c.id);
    const admin = m.find((x) => x.roleCode === "admin" && x.status === "active") ?? m[0];
    const lastLogin = m
      .map((x) => (x.lastLoginAt ? x.lastLoginAt.getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const license = evaluateLicense(c.licenseStatus, c.licenseExpiresAt);
    return {
      id: c.id,
      tradeName: c.tradeName,
      legalName: c.legalName,
      cnpj: c.cnpj,
      phone: c.phone,
      email: c.email,
      city: c.city,
      state: c.state,
      createdAt: c.createdAt,
      licenseStatus: c.licenseStatus,
      licensePlan: c.licensePlan,
      licenseExpiresAt: c.licenseExpiresAt,
      licenseNotes: c.licenseNotes,
      licenseState: license.state,
      licenseDaysLeft: license.daysLeft,
      adminName: admin?.name ?? null,
      adminEmail: admin?.email ?? null,
      userCount: m.filter((x) => x.status === "active").length,
      establishmentCount: estCounts.find((e) => e.companyId === c.id)?.total ?? 0,
      lastLoginAt: lastLogin ? new Date(lastLogin).toISOString() : null,
    };
  });

  return NextResponse.json({ companies: list });
}

/** Cria uma empresa cliente já com administrador e licença (senha provisória exibida uma única vez). */
export async function POST(req: Request) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const tradeName = sanitizeText(body.tradeName, 200);
  const legalName = sanitizeText(body.legalName, 200) || tradeName;
  const cnpj = String(body.cnpj ?? "").replace(/\D/g, "");
  const adminName = sanitizeText(body.adminName, 160);
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
  const plan = sanitizeText(body.plan, 60) || null;
  const days = Number(body.days ?? 30);
  const trial = body.trial === true;

  if (!tradeName || cnpj.length < 11 || !adminName || !isValidEmail(adminEmail)) {
    return NextResponse.json(
      { error: "Informe nome fantasia, CNPJ/CPF, nome e e-mail do administrador do cliente." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return NextResponse.json({ error: "Prazo inválido (1 a 3650 dias)." }, { status: 400 });
  }

  const [dupCompany] = await db.select({ id: companies.id }).from(companies).where(eq(companies.cnpj, cnpj)).limit(1);
  if (dupCompany) return NextResponse.json({ error: "Já existe empresa com este CNPJ/CPF." }, { status: 409 });
  const [dupUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1);
  if (dupUser) return NextResponse.json({ error: "Já existe usuário com este e-mail." }, { status: 409 });

  const tempPassword = generateTempPassword();
  const expiresAt = extendExpiry(null, days);
  const status = trial ? "trial" : "active";

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: adminName, email: adminEmail, passwordHash: hashPassword(tempPassword), status: "active", mustChangePassword: true })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({
        legalName,
        tradeName,
        cnpj,
        email: adminEmail,
        phone: sanitizeText(body.phone, 30) || null,
        status: "active",
        licenseStatus: status,
        licensePlan: plan,
        licenseExpiresAt: expiresAt,
        licenseUpdatedAt: new Date(),
      })
      .returning();
    const [est] = await tx
      .insert(establishments)
      .values({ companyId: company.id, name: "Matriz", code: "001", cnpj, isDefault: true, status: "active" })
      .returning();
    await tx.insert(companyUsers).values({
      companyId: company.id,
      userId: user.id,
      defaultEstablishmentId: est.id,
      roleCode: "admin",
      maxDiscountPercent: "100.00",
      status: "active",
    });
    await seedCompanyDefaults(tx, company.id);
    await tx.insert(licenseEvents).values({
      companyId: company.id,
      action: "created",
      newStatus: status,
      expiresAt,
      note: plan ? `Cliente criado · plano ${plan}` : "Cliente criado",
      createdByName: ctx.user.name,
    });
    await recordAudit(
      {
        companyId: company.id,
        establishmentId: est.id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        action: "platform_company_created",
        entity: "company",
        entityId: company.id,
        newData: { tradeName, cnpj, adminEmail, licenseStatus: status },
        ...extractRequestMeta(req),
      },
      tx as unknown as typeof db
    );
    return { company, user };
  });

  return NextResponse.json(
    { ok: true, companyId: created.company.id, adminEmail, tempPassword, expiresAt },
    { status: 201 }
  );
}

