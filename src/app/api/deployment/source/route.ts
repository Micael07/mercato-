import { NextResponse } from "next/server";
import { requireDeploymentAdmin } from "@/lib/deployment/access";
import { canExportSource } from "@/lib/deployment/model";
import { createSourceArchive } from "@/lib/deployment/export-source";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { extractRequestMeta, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Never export production source, even if an administrator enables the flag.
  if (!canExportSource(process.env)) {
    return NextResponse.json({ error: "Recurso não disponível neste ambiente." }, { status: 404 });
  }
  try {
    const auth = await requireDeploymentAdmin(req);
    if ("error" in auth) return auth.error;
    if (req.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Abra o download pelo painel do Mercato." }, { status: 403 });
    }
    const limit = checkRateLimit(`source-export:${auth.ctx.user.id}`, 2, 60000);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    const archive = await createSourceArchive(process.cwd());
    await recordAudit({
      companyId: auth.ctx.company.id,
      establishmentId: auth.ctx.establishment.id,
      userId: auth.ctx.user.id,
      userName: auth.ctx.user.name,
      action: "source_export_downloaded",
      entity: "deployment",
      newData: { files: archive.manifest.entries.length, archiveBytes: archive.bytes.byteLength },
      ...extractRequestMeta(req),
    });
    return new Response(new Uint8Array(archive.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="mercato-publicacao.zip"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o pacote. Tente o script de exportação na pasta do projeto." }, { status: 503 });
  }
}
