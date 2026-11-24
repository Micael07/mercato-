import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, users, companyUsers, establishments, companies } from "@/db";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { evaluateLicense, licenseBlockedMessage } from "@/lib/license";
import { isPlatformAdminEmail } from "@/lib/platform";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const DUMMY_HASH =
  "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const ipLimit = checkRateLimit(`login:ip:${ip}`, 15, 10 * 60 * 1000);
    if (!ipLimit.allowed) {
      return rateLimitResponse(ipLimit.retryAfterSeconds);
    }

    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Informe e-mail e senha." },
        { status: 400 }
      );
    }

    const emailLimit = checkRateLimit(`login:email:${email}`, 8, 10 * 60 * 1000);
    if (!emailLimit.allowed) {
      return rateLimitResponse(emailLimit.retryAfterSeconds);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const meta = extractRequestMeta(req);
    const validPass = verifyPassword(
      password,
      user ? user.passwordHash : DUMMY_HASH
    );

    if (!user || !validPass) {
      await recordAudit({
        action: "login_failed",
        entity: "auth",
        newData: { email },
        ...meta,
      });
      return NextResponse.json(
        { error: "Credenciais inválidas." },
        { status: 401 }
      );
    }

    if (user.status !== "active") {
      return NextResponse.json(
        { error: "Usuário inativo. Contate o administrador." },
        { status: 403 }
      );
    }

    const allMemberships = await db
      .select({
        companyId: companyUsers.companyId,
        defaultEstablishmentId: companyUsers.defaultEstablishmentId,
        roleCode: companyUsers.roleCode,
        licenseStatus: companies.licenseStatus,
        licenseExpiresAt: companies.licenseExpiresAt,
      })
      .from(companyUsers)
      .innerJoin(companies, eq(companyUsers.companyId, companies.id))
      .where(
        and(
          eq(companyUsers.userId, user.id),
          eq(companyUsers.status, "active"),
          eq(companies.status, "active")
        )
      );

    if (allMemberships.length === 0) {
      return NextResponse.json(
        { error: "Usuário não possui vínculo ativo com nenhuma empresa." },
        { status: 403 }
      );
    }

    // Licença: só entra em empresa com acesso liberado e dentro do prazo.
    // O dono da plataforma não é barrado pela própria licença.
    const platformAdmin = isPlatformAdminEmail(user.email);
    const evaluated = allMemberships.map((m) => ({
      ...m,
      license: evaluateLicense(m.licenseStatus, m.licenseExpiresAt),
    }));
    const memberships = evaluated.filter(
      (m) => platformAdmin || m.license.state === "ok" || m.license.state === "expiring"
    );
    if (memberships.length === 0) {
      await recordAudit({
        companyId: allMemberships[0].companyId,
        userId: user.id,
        userName: user.name,
        action: "login_blocked_license",
        entity: "auth",
        entityId: user.id,
        newData: { state: evaluated[0].license.state },
        ...meta,
      });
      return NextResponse.json(
        { error: licenseBlockedMessage(evaluated[0].license.state), license: evaluated[0].license.state },
        { status: 403 }
      );
    }

    const first = memberships[0];
    let establishmentId = first.defaultEstablishmentId;

    if (!establishmentId) {
      const [est] = await db
        .select({ id: establishments.id })
        .from(establishments)
        .where(
          and(
            eq(establishments.companyId, first.companyId),
            eq(establishments.status, "active")
          )
        )
        .limit(1);
      establishmentId = est?.id ?? null;
    }

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    await setSessionCookie({
      userId: user.id,
      companyId: first.companyId,
      establishmentId,
    });

    await recordAudit({
      companyId: first.companyId,
      establishmentId,
      userId: user.id,
      userName: user.name,
      action: "login",
      entity: "auth",
      entityId: user.id,
      newData: { role: first.roleCode },
      ...meta,
    });

    return NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { error: "Erro interno ao autenticar." },
      { status: 500 }
    );
  }
}
