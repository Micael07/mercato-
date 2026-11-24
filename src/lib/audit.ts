import { db, auditLogs } from "@/db";

export interface AuditInput {
  companyId?: string | null;
  establishmentId?: string | null;
  userId?: string | null;
  userName?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  previousData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(input: AuditInput, tx?: typeof db) {
  const executor = tx ?? db;
  await executor.insert(auditLogs).values({
    companyId: input.companyId ?? null,
    establishmentId: input.establishmentId ?? null,
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    previousData: input.previousData ?? null,
    newData: input.newData ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export function extractRequestMeta(req?: Request) {
  if (!req) return { ipAddress: null, userAgent: null };
  const forwarded = req.headers.get("x-forwarded-for");
  const ipAddress = forwarded ? forwarded.split(",")[0].trim() : null;
  const userAgent = req.headers.get("user-agent");
  return { ipAddress, userAgent };
}
