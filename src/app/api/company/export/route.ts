import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { buildCompanyExport } from "@/lib/company-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Backup: ZIP com todos os dados da empresa. Só quem altera configurações (administrador). */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "settings.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const limit = checkRateLimit(`export:${ctx.company.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const { zip, summary } = await buildCompanyExport(ctx.company.id, ctx.user.name);
  await recordAudit({ companyId: ctx.company.id, userId: ctx.user.id, userName: ctx.user.name, action: "company_data_exported", entity: "company", entityId: ctx.company.id, newData: summary, ...extractRequestMeta(req) });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mercato-backup-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
