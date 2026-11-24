import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  db,
  users,
  companies,
  establishments,
  companyUsers,
} from "@/db";
import { seedCompanyDefaults } from "@/lib/services/provision";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { isValidEmail, sanitizeText, validatePasswordStrength } from "@/lib/security";
import { isPlatformAdminEmail } from "@/lib/platform";

export async function POST(req: Request) {
  if (process.env.ALLOW_PUBLIC_REGISTRATION === "false") {
    return NextResponse.json(
      { error: "Novos cadastros estão fechados. Solicite um convite ao administrador." },
      { status: 403 }
    );
  }
  try {
    const ip = getClientIp(req);
    const limit = checkRateLimit(`register:ip:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }

    const body = await req.json();
    const name = sanitizeText(body?.name, 160);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const tradeName = sanitizeText(body?.tradeName, 200);
    const legalName = sanitizeText(body?.legalName ?? tradeName, 200) || tradeName;
    const cnpj = String(body?.cnpj ?? "").replace(/\D/g, "");
    const establishmentName =
      sanitizeText(body?.establishmentName ?? "Matriz", 180) || "Matriz";

    if (!name || !isValidEmail(email) || !tradeName || cnpj.length < 11) {
      return NextResponse.json(
        {
          error:
            "Preencha nome, e-mail válido, nome fantasia e CNPJ/CPF válido.",
        },
        { status: 400 }
      );
    }

    const pwdCheck = validatePasswordStrength(password);
    if (!pwdCheck.valid) {
      return NextResponse.json({ error: pwdCheck.error }, { status: 400 });
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser) {
      return NextResponse.json(
        { error: "Já existe uma conta cadastrada com este e-mail." },
        { status: 409 }
      );
    }

    const [existingComp] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.cnpj, cnpj))
      .limit(1);
    if (existingComp) {
      return NextResponse.json(
        { error: "Já existe uma empresa cadastrada com este CNPJ." },
        { status: 409 }
      );
    }

    // Dono da plataforma entra liberado; qualquer outro cadastro fica aguardando
    // a liberação (acesso pago) feita pelo administrador da plataforma.
    const ownerAccount = isPlatformAdminEmail(email);

    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name,
          email,
          passwordHash: hashPassword(password),
          status: "active",
        })
        .returning();

      const [company] = await tx
        .insert(companies)
        .values({
          legalName,
          tradeName,
          cnpj,
          email,
          status: "active",
          licenseStatus: ownerAccount ? "active" : "pending",
          licenseUpdatedAt: new Date(),
        })
        .returning();

      const [est] = await tx
        .insert(establishments)
        .values({
          companyId: company.id,
          name: establishmentName || "Matriz",
          code: "001",
          cnpj,
          isDefault: true,
          status: "active",
        })
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

      const meta = extractRequestMeta(req);
      await recordAudit(
        {
          companyId: company.id,
          establishmentId: est.id,
          userId: user.id,
          userName: user.name,
          action: "company_onboarding",
          entity: "company",
          entityId: company.id,
          newData: { tradeName, cnpj, establishment: est.name },
          ...meta,
        },
        tx as unknown as typeof db
      );

      return { user, company, est };
    });

    if (!ownerAccount) {
      // Sem sessão: o acesso só começa depois da liberação pelo administrador.
      return NextResponse.json(
        {
          ok: true,
          pending: true,
          message:
            "Cadastro recebido! Seu acesso será liberado após a confirmação do pagamento.",
        },
        { status: 201 }
      );
    }

    await setSessionCookie({
      userId: result.user.id,
      companyId: result.company.id,
      establishmentId: result.est.id,
    });

    return NextResponse.json(
      { ok: true, companyId: result.company.id },
      { status: 201 }
    );
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { error: "Erro ao concluir cadastro inicial." },
      { status: 500 }
    );
  }
}
