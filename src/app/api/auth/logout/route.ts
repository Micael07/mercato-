import { NextResponse } from "next/server";
import { clearSessionCookie, getAuthContext } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (ctx) {
    const meta = extractRequestMeta(req);
    await recordAudit({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: "logout",
      entity: "auth",
      entityId: ctx.user.id,
      ...meta,
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
