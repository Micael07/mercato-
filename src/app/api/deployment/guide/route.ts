import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireDeploymentAdmin } from "@/lib/deployment/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCUMENTS = new Map([
  ["tutorial", { path: "PUBLICACAO.md", name: "Mercato-Guia-de-Publicacao.md" }],
  ["production", { path: "CHECKLIST_PRODUCAO.md", name: "Mercato-Checklist-de-Producao.md" }],
]);

export async function GET(req: Request) {
  try {
    const auth = await requireDeploymentAdmin(req);
    if ("error" in auth) return auth.error;
    const selected = DOCUMENTS.get(new URL(req.url).searchParams.get("document") || "tutorial");
    if (!selected) {
      return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    }
    // Only the two fixed document paths above can be read; no client-supplied path.
    const content = await readFile(path.join(process.cwd(), "docs", selected.path), "utf8");
    return new Response(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${selected.name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível baixar o documento. Consulte a pasta docs do projeto." }, { status: 503 });
  }
}
