import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/security";
import { buildCompanyExport } from "@/lib/company-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** O ADM da plataforma baixa o backup completo de qualquer cliente (ex.: cancelamento ou pedido do cliente). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const { zip, summary } = await buildCompanyExport(id, auth.ctx.user.name);
  await recordAudit({ companyId: id, userId: auth.ctx.user.id, userName: auth.ctx.user.name, action: "platform_company_data_exported", entity: "company", entityId: id, newData: summary, ...extractRequestMeta(req) });
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="mercato-backup-${id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
