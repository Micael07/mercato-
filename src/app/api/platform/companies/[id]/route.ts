import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, companies, licenseEvents } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { extendExpiry, LICENSE_STATUSES, type LicenseStatus } from "@/lib/license";
import { isUuid, sanitizeText } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  const events = await db
    .select()
    .from(licenseEvents)
    .where(eq(licenseEvents.companyId, id))
    .orderBy(desc(licenseEvents.createdAt))
    .limit(50);
  return NextResponse.json({ events });
}

/**
 * Libera, renova, bloqueia ou ajusta a licença de uma empresa.
 * Corpo: { licenseStatus?, extendDays?, expiresAt? (ISO | null), plan?, notes?, note? }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const [current] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!current) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });

  let status = current.licenseStatus as LicenseStatus;
  let expiresAt: Date | null = current.licenseExpiresAt;
  let action = "updated";

  if (body.licenseStatus !== undefined) {
    if (!LICENSE_STATUSES.includes(body.licenseStatus as LicenseStatus)) {
      return NextResponse.json({ error: "Situação de licença inválida." }, { status: 400 });
    }
    status = body.licenseStatus as LicenseStatus;
    action = status === "suspended" ? "suspended" : status === "pending" ? "set_pending" : "released";
  }

  if (body.extendDays !== undefined) {
    const days = Number(body.extendDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return NextResponse.json({ error: "Prazo inválido (1 a 3650 dias)." }, { status: 400 });
    }
    expiresAt = extendExpiry(current.licenseExpiresAt, days);
    // Renovar uma empresa bloqueada/pendente também libera o acesso.
    if (status === "pending" || status === "suspended") status = "active";
    action = "renewed";
  } else if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === "") {
      expiresAt = null; // sem vencimento
    } else {
      const parsed = new Date(String(body.expiresAt));
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Data de vencimento inválida." }, { status: 400 });
      }
      // Vencimento vale até o fim do dia informado (horário de Brasília).
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresAt))) {
        parsed.setUTCHours(26, 59, 59, 0); // 23:59:59 em UTC-3
      }
      expiresAt = parsed;
    }
    if (action === "updated") action = "expiry_changed";
  }

  const plan = body.plan !== undefined ? sanitizeText(body.plan, 60) || null : current.licensePlan;
  const notes =
    body.notes !== undefined ? sanitizeText(body.notes, 2000) || null : current.licenseNotes;
  const eventNote = sanitizeText(body.note, 500) || null;

  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(companies)
      .set({
        licenseStatus: status,
        licenseExpiresAt: expiresAt,
        licensePlan: plan,
        licenseNotes: notes,
        licenseUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, id))
      .returning();
    await tx.insert(licenseEvents).values({
      companyId: id,
      action,
      previousStatus: current.licenseStatus,
      newStatus: status,
      expiresAt,
      note: eventNote,
      createdByName: ctx.user.name,
    });
    return rows;
  });

  await recordAudit({
    companyId: id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "platform_license_changed",
    entity: "company",
    entityId: id,
    previousData: { status: current.licenseStatus, expiresAt: current.licenseExpiresAt },
    newData: { status, expiresAt, plan },
    ...extractRequestMeta(req),
  });

  return NextResponse.json({ ok: true, company: { id: updated.id, licenseStatus: updated.licenseStatus, licenseExpiresAt: updated.licenseExpiresAt } });
}
