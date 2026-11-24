import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  companies,
  establishments,
  companyUsers,
  companySettings,
  paymentMethods,
  financialCategories,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const memberships = await db
    .select({ companyId: companyUsers.companyId, roleCode: companyUsers.roleCode })
    .from(companyUsers)
    .where(and(eq(companyUsers.userId, ctx.user.id), eq(companyUsers.status, "active")));

  const companyIds = memberships.map((m) => m.companyId);
  if (companyIds.length === 0) return NextResponse.json({ companies: [] });

  const compRows = await db
    .select()
    .from(companies)
    .where(inArray(companies.id, companyIds))
    .orderBy(asc(companies.tradeName));

  const estRows = await db
    .select()
    .from(establishments)
    .where(inArray(establishments.companyId, companyIds))
    .orderBy(asc(establishments.code));

  return NextResponse.json({
    companies: compRows.map(({ licenseNotes, ...c }) => ({
      ...c,
      establishments: estRows.filter((e) => e.companyId === c.id),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "companies.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const kind = String(body?.kind ?? "establishment");

  if (kind === "company") {
    // Acesso pago: só o administrador da plataforma cria empresas clientes
    // (em /plataforma). Cliente criando empresa sozinho burlaria a cobrança.
    if (!ctx.isPlatformAdmin) {
      return NextResponse.json(
        { error: "Novas empresas são criadas pelo fornecedor do Mercato." },
        { status: 403 }
      );
    }
    const tradeName = String(body?.tradeName ?? "").trim();
    const legalName = String(body?.legalName ?? tradeName).trim();
    const cnpj = String(body?.cnpj ?? "").replace(/\D/g, "");
    if (!tradeName || cnpj.length < 11) {
      return NextResponse.json(
        { error: "Informe nome fantasia e CNPJ válido." },
        { status: 400 }
      );
    }

    const [dup] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.cnpj, cnpj))
      .limit(1);
    if (dup) {
      return NextResponse.json({ error: "CNPJ já cadastrado." }, { status: 409 });
    }

    const created = await db.transaction(async (tx) => {
      const [comp] = await tx
        .insert(companies)
        .values({
          legalName,
          tradeName,
          cnpj,
          stateRegistration: body?.stateRegistration || null,
          municipalRegistration: body?.municipalRegistration || null,
          phone: body?.phone || null,
          email: body?.email || null,
          address: body?.address || null,
          zipCode: body?.zipCode || null,
          city: body?.city || null,
          state: body?.state ? String(body.state).slice(0, 2).toUpperCase() : null,
          licenseStatus: "active",
          licenseUpdatedAt: new Date(),
        })
        .returning();

      const [est] = await tx
        .insert(establishments)
        .values({
          companyId: comp.id,
          name: String(body?.establishmentName ?? "Matriz"),
          code: "001",
          cnpj,
          isDefault: true,
        })
        .returning();

      await tx.insert(companyUsers).values({
        companyId: comp.id,
        userId: ctx.user.id,
        defaultEstablishmentId: est.id,
        roleCode: "admin",
        maxDiscountPercent: "100.00",
      });

      await tx.insert(companySettings).values({ companyId: comp.id });
      await tx.insert(paymentMethods).values([
        { companyId: comp.id, name: "Dinheiro", code: "cash", sortOrder: 1 },
        { companyId: comp.id, name: "PIX", code: "pix", sortOrder: 2 },
        { companyId: comp.id, name: "Cartão de Débito", code: "debit", sortOrder: 3 },
        {
          companyId: comp.id,
          name: "Cartão de Crédito",
          code: "credit",
          allowsInstallments: true,
          maxInstallments: 12,
          sortOrder: 4,
        },
      ]);
      await tx.insert(financialCategories).values([
        { companyId: comp.id, name: "Vendas", type: "income" },
        { companyId: comp.id, name: "Compras", type: "expense" },
      ]);

      await recordAudit(
        {
          companyId: comp.id,
          establishmentId: est.id,
          userId: ctx.user.id,
          userName: ctx.user.name,
          action: "company_created",
          entity: "company",
          entityId: comp.id,
          newData: { tradeName, cnpj },
        },
        tx as unknown as typeof db
      );

      return comp;
    });

    return NextResponse.json({ company: created }, { status: 201 });
  }

  // Create establishment inside current company
  const name = String(body?.name ?? "").trim();
  const code = String(body?.code ?? "").trim();
  if (!name || !code) {
    return NextResponse.json(
      { error: "Informe nome e código do estabelecimento." },
      { status: 400 }
    );
  }

  const [est] = await db
    .insert(establishments)
    .values({
      companyId: ctx.company.id,
      name,
      code,
      cnpj: body?.cnpj ? String(body.cnpj).replace(/\D/g, "") : null,
      address: body?.address || null,
      phone: body?.phone || null,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: est.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "establishment_created",
    entity: "establishment",
    entityId: est.id,
    newData: { name, code },
  });

  return NextResponse.json({ establishment: est }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "companies.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  if (body?.kind === "establishment" && body?.id) {
    const [est] = await db
      .update(establishments)
      .set({
        name: body?.name ? String(body.name).trim() : undefined,
        address: body?.address !== undefined ? body.address : undefined,
        phone: body?.phone !== undefined ? body.phone : undefined,
        status: body?.status !== undefined ? body.status : undefined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(establishments.id, String(body.id)),
          eq(establishments.companyId, ctx.company.id)
        )
      )
      .returning();
    return NextResponse.json({ establishment: est });
  }

  const [updated] = await db
    .update(companies)
    .set({
      tradeName: body?.tradeName ? String(body.tradeName).trim() : undefined,
      legalName: body?.legalName ? String(body.legalName).trim() : undefined,
      stateRegistration:
        body?.stateRegistration !== undefined ? body.stateRegistration : undefined,
      municipalRegistration:
        body?.municipalRegistration !== undefined
          ? body.municipalRegistration
          : undefined,
      phone: body?.phone !== undefined ? body.phone : undefined,
      email: body?.email !== undefined ? body.email : undefined,
      address: body?.address !== undefined ? body.address : undefined,
      zipCode: body?.zipCode !== undefined ? body.zipCode : undefined,
      city: body?.city !== undefined ? body.city : undefined,
      state: body?.state !== undefined ? body.state : undefined,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, ctx.company.id))
    .returning();

  return NextResponse.json({ company: updated });
}
