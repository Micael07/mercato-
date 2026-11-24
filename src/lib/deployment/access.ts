import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";

export async function requireDeploymentAdmin(req: Request) {
  const result = await requireApiAuth(req, "settings.manage");
  if ("error" in result) return result;
  if (result.ctx.membership.roleCode !== "admin") {
    await recordAudit({
      companyId: result.ctx.company.id,
      establishmentId: result.ctx.establishment.id,
      userId: result.ctx.user.id,
      userName: result.ctx.user.name,
      action: "unauthorized_deployment_access",
      entity: "deployment",
      ...extractRequestMeta(req),
    });
    return {
      error: NextResponse.json({ error: "Somente administradores podem acessar a publicação." }, { status: 403 }),
    };
  }
  return result;
}
