import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  companies,
  establishments,
  companyUsers,
  companySettings,
} from "@/db";
import {
  PermissionCode,
  resolvePermissions,
  RoleCode,
} from "@/lib/permissions";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { evaluateLicense, licenseValidSql, type LicenseState } from "@/lib/license";
import { isPlatformAdminEmail } from "@/lib/platform";

export const SESSION_COOKIE_NAME = "mercato_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const globalForAuth = globalThis as typeof globalThis & {
  __mercatoEphemeralSecret?: string;
};

function getAuthSecret(): string {
  const configured = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (configured && configured.length >= 16) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET (mínimo 16 caracteres) deve ser configurado em produção."
    );
  }
  if (!globalForAuth.__mercatoEphemeralSecret) {
    globalForAuth.__mercatoEphemeralSecret =
      "mercato-dev-secret-" + crypto.createHash("sha256").update(process.cwd()).digest("hex");
  }
  return globalForAuth.__mercatoEphemeralSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export interface SessionPayload {
  userId: string;
  companyId: string | null;
  establishmentId: string | null;
  iat: number;
  exp: number;
}

export function signSessionToken(
  payload: Omit<SessionPayload, "exp" | "iat">
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return null;
    const expectedSig = crypto
      .createHmac("sha256", getAuthSecret())
      .update(encoded)
      .digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as SessionPayload;
    if (!payload.userId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  payload: Omit<SessionPayload, "exp" | "iat">
): Promise<void> {
  const token = signSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
    mustChangePassword: boolean;
    recoveryConfigured: boolean;
  };
  company: {
    id: string;
    legalName: string;
    tradeName: string;
    cnpj: string;
    logoUrl: string | null;
    status: string;
    licenseStatus: string;
    licensePlan: string | null;
    licenseExpiresAt: string | null;
    licenseState: LicenseState;
    licenseDaysLeft: number | null;
  };
  isPlatformAdmin: boolean;
  establishment: {
    id: string;
    name: string;
    code: string;
    cnpj: string | null;
    address: string | null;
    phone: string | null;
  };
  membership: {
    id: string;
    roleCode: RoleCode;
    maxDiscountPercent: number;
  };
  settings: {
    allowNegativeStock: boolean;
    allowDuplicateBarcode: boolean;
    maxDiscountPercent: number;
    managerMaxDiscountPercent: number;
    decimalPlaces: number;
    currency: string;
    requireOpenCashRegister: boolean;
    singleOpenCashPerOperator: boolean;
    receiptFooter: string;
    thermalPrintEnabled: boolean;
  };
  permissions: Set<PermissionCode>;
  availableCompanies: Array<{
    companyId: string;
    tradeName: string;
    cnpj: string;
    roleCode: string;
    establishments: Array<{ id: string; name: string; code: string }>;
  }>;
}

export async function getRawSessionUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      status: users.status,
      sessionValidAfter: users.sessionValidAfter,
      mustChangePassword: users.mustChangePassword,
      recoveryHash: users.recoveryHash,
    })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user || user.status !== "active") return null;
  if (
    user.sessionValidAfter &&
    payload.iat < Math.floor(user.sessionValidAfter.getTime() / 1000)
  ) {
    return null;
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      recoveryConfigured: !!user.recoveryHash,
    },
    payload,
  };
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const raw = await getRawSessionUser();
  if (!raw) return null;
  const { user, payload } = raw;
  const isPlatformAdmin = isPlatformAdminEmail(user.email);

  const memberships = await db
    .select({
      membershipId: companyUsers.id,
      companyId: companyUsers.companyId,
      roleCode: companyUsers.roleCode,
      customPermissions: companyUsers.customPermissions,
      maxDiscountPercent: companyUsers.maxDiscountPercent,
      defaultEstablishmentId: companyUsers.defaultEstablishmentId,
      membershipStatus: companyUsers.status,
      tradeName: companies.tradeName,
      legalName: companies.legalName,
      cnpj: companies.cnpj,
      logoUrl: companies.logoUrl,
      companyStatus: companies.status,
      licenseStatus: companies.licenseStatus,
      licensePlan: companies.licensePlan,
      licenseExpiresAt: companies.licenseExpiresAt,
    })
    .from(companyUsers)
    .innerJoin(companies, eq(companyUsers.companyId, companies.id))
    .where(
      and(
        eq(companyUsers.userId, user.id),
        eq(companyUsers.status, "active"),
        eq(companies.status, "active"),
        // O dono da plataforma nunca é bloqueado pela própria licença.
        isPlatformAdmin ? undefined : licenseValidSql()
      )
    );

  if (memberships.length === 0) return null;

  const activeMembership =
    memberships.find((m) => m.companyId === payload.companyId) ?? memberships[0];

  const allEsts = await db
    .select({
      id: establishments.id,
      companyId: establishments.companyId,
      name: establishments.name,
      code: establishments.code,
      cnpj: establishments.cnpj,
      address: establishments.address,
      phone: establishments.phone,
      isDefault: establishments.isDefault,
      status: establishments.status,
    })
    .from(establishments)
    .where(
      and(
        eq(establishments.status, "active"),
        inArray(
          establishments.companyId,
          memberships.map((m) => m.companyId)
        )
      )
    );

  const companyEsts = allEsts.filter(
    (e) => e.companyId === activeMembership.companyId
  );
  if (companyEsts.length === 0) return null;

  const activeEst =
    companyEsts.find((e) => e.id === payload.establishmentId) ??
    companyEsts.find((e) => e.id === activeMembership.defaultEstablishmentId) ??
    companyEsts.find((e) => e.isDefault) ??
    companyEsts[0];

  const [settingsRow] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, activeMembership.companyId))
    .limit(1);

  const permissions = resolvePermissions(
    activeMembership.roleCode,
    activeMembership.customPermissions
  );

  const availableCompanies = memberships.map((m) => ({
    companyId: m.companyId,
    tradeName: m.tradeName,
    cnpj: m.cnpj,
    roleCode: m.roleCode,
    establishments: allEsts
      .filter((e) => e.companyId === m.companyId)
      .map((e) => ({ id: e.id, name: e.name, code: e.code })),
  }));

  const license = evaluateLicense(
    activeMembership.licenseStatus,
    activeMembership.licenseExpiresAt
  );

  return {
    user,
    isPlatformAdmin,
    company: {
      id: activeMembership.companyId,
      legalName: activeMembership.legalName,
      tradeName: activeMembership.tradeName,
      cnpj: activeMembership.cnpj,
      logoUrl: activeMembership.logoUrl,
      status: activeMembership.companyStatus,
      licenseStatus: activeMembership.licenseStatus,
      licensePlan: activeMembership.licensePlan,
      licenseExpiresAt: activeMembership.licenseExpiresAt
        ? activeMembership.licenseExpiresAt.toISOString()
        : null,
      licenseState: license.state,
      licenseDaysLeft: license.daysLeft,
    },
    establishment: {
      id: activeEst.id,
      name: activeEst.name,
      code: activeEst.code,
      cnpj: activeEst.cnpj,
      address: activeEst.address,
      phone: activeEst.phone,
    },
    membership: {
      id: activeMembership.membershipId,
      roleCode: activeMembership.roleCode as RoleCode,
      maxDiscountPercent: Number(activeMembership.maxDiscountPercent ?? 5),
    },
    settings: {
      allowNegativeStock: settingsRow?.allowNegativeStock ?? false,
      allowDuplicateBarcode: settingsRow?.allowDuplicateBarcode ?? false,
      maxDiscountPercent: Number(settingsRow?.maxDiscountPercent ?? 10),
      managerMaxDiscountPercent: Number(settingsRow?.managerMaxDiscountPercent ?? 25),
      decimalPlaces: settingsRow?.decimalPlaces ?? 2,
      currency: settingsRow?.currency ?? "BRL",
      requireOpenCashRegister: settingsRow?.requireOpenCashRegister ?? true,
      singleOpenCashPerOperator: settingsRow?.singleOpenCashPerOperator ?? true,
      receiptFooter:
        settingsRow?.receiptFooter ?? "Obrigado pela preferência! Volte sempre.",
      thermalPrintEnabled: settingsRow?.thermalPrintEnabled ?? true,
    },
    permissions,
    availableCompanies,
  };
}

export async function requireApiAuth(
  req: Request,
  permission?: PermissionCode
): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      error: NextResponse.json(
        { error: "Sessão expirada ou não autenticada." },
        { status: 401 }
      ),
    };
  }

  if (ctx.user.mustChangePassword) {
    return {
      error: NextResponse.json(
        { error: "Troque a senha provisória para continuar.", code: "password_change_required" },
        { status: 403 }
      ),
    };
  }

  if (permission && !ctx.permissions.has(permission)) {
    const meta = extractRequestMeta(req);
    await recordAudit({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: "unauthorized_access_attempt",
      entity: "permission",
      entityId: permission,
      newData: { url: req.url, method: req.method, role: ctx.membership.roleCode },
      ...meta,
    });
    return {
      error: NextResponse.json(
        {
          error: `Acesso negado. Permissão necessária: ${permission}`,
        },
        { status: 403 }
      ),
    };
  }

  return { ctx };
}

export async function requirePlatformAdmin(
  req: Request
): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  const auth = await requireApiAuth(req);
  if ("error" in auth) return auth;
  if (!auth.ctx.isPlatformAdmin) {
    const meta = extractRequestMeta(req);
    await recordAudit({
      companyId: auth.ctx.company.id,
      userId: auth.ctx.user.id,
      userName: auth.ctx.user.name,
      action: "unauthorized_platform_access",
      entity: "platform",
      newData: { url: req.url, method: req.method },
      ...meta,
    });
    return {
      error: NextResponse.json({ error: "Acesso restrito ao administrador da plataforma." }, { status: 403 }),
    };
  }
  return auth;
}
