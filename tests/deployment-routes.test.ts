import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  apiAuth: vi.fn(),
  execute: vi.fn(),
  archive: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/deployment/access", () => ({ requireDeploymentAdmin: mocks.access }));
vi.mock("@/lib/auth", () => ({ requireApiAuth: mocks.apiAuth }));
vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, extractRequestMeta: () => ({ ipAddress: null, userAgent: null }) }));
vi.mock("@/lib/deployment/export-source", () => ({ createSourceArchive: mocks.archive }));

const context = {
  user: { id: "publication-test-user", name: "Publication Test" },
  company: { id: "publication-test-company" },
  establishment: { id: "publication-test-establishment" },
  membership: { roleCode: "admin" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ ctx: context });
  mocks.apiAuth.mockResolvedValue({ ctx: context });
  mocks.audit.mockResolvedValue(undefined);
  vi.stubEnv("DEPLOYMENT_TARGET", "preview");
  vi.stubEnv("ALLOW_SOURCE_EXPORT", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("APIs de publicação", () => {
  it("bloqueia exportação em modo público antes de autenticar ou ler arquivos", async () => {
    vi.stubEnv("DEPLOYMENT_TARGET", "public");
    const { GET } = await import("@/app/api/deployment/source/route");
    expect((await GET(new Request("http://localhost/api/deployment/source"))).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("bloqueia exportação com flag desligada", async () => {
    vi.stubEnv("ALLOW_SOURCE_EXPORT", "false");
    const { GET } = await import("@/app/api/deployment/source/route");
    expect((await GET(new Request("http://localhost/api/deployment/source"))).status).toBe(404);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("não gera arquivo para visitante sem autenticação", async () => {
    mocks.access.mockResolvedValue({ error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) });
    const { GET } = await import("@/app/api/deployment/source/route");
    expect((await GET(new Request("http://localhost/api/deployment/source"))).status).toBe(401);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("recusa solicitação de exportação cross-site", async () => {
    const { GET } = await import("@/app/api/deployment/source/route");
    const response = await GET(new Request("http://localhost/api/deployment/source", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(response.status).toBe(403);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("exportação autorizada responde como anexo privado e gera auditoria", async () => {
    mocks.archive.mockResolvedValue({ bytes: new Uint8Array([80, 75, 3, 4]), manifest: { entries: [{ path: "package.json" }] } });
    const { GET } = await import("@/app/api/deployment/source/route");
    const response = await GET(new Request("http://localhost/api/deployment/source"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "source_export_downloaded", companyId: context.company.id,
    }));
  });

  it("download de guia não aceita caminho arbitrário", async () => {
    const { GET } = await import("@/app/api/deployment/guide/route");
    const response = await GET(new Request("http://localhost/api/deployment/guide?document=../../.env"));
    expect(response.status).toBe(404);
  });

  it("guia autorizado é baixado com conteúdo real e cache privado", async () => {
    const { GET } = await import("@/app/api/deployment/guide/route");
    const response = await GET(new Request("http://localhost/api/deployment/guide"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(await response.text()).toContain("Publicar o Mercato");
  });

  it("diagnóstico consulta o banco sem enviar credenciais ou aprovar uso comercial", async () => {
    vi.stubEnv("AUTH_SECRET", "private-session-value-".repeat(3));
    vi.stubEnv("DATABASE_URL", "postgresql://private-user:private-pass@private.example/db?sslmode=verify-full");
    mocks.execute.mockResolvedValueOnce({ rows: [{ name: "public.users", present: true }] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ present: true }] });
    const { GET } = await import("@/app/api/deployment/status/route");
    const response = await GET(new Request("http://localhost/api/deployment/status"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.commercialReleaseApproved).toBe(false);
    expect(json.checks.some((check: { id: string; state: string }) => check.id === "database-connectivity" && check.state === "ok")).toBe(true);
    expect(JSON.stringify(json)).not.toContain("private-pass");
    expect(JSON.stringify(json)).not.toContain(process.env.AUTH_SECRET);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("verificação real de acesso rejeita perfil não administrador", async () => {
    mocks.apiAuth.mockResolvedValue({ ctx: { ...context, membership: { roleCode: "manager" } } });
    const actual = await vi.importActual<typeof import("@/lib/deployment/access")>("@/lib/deployment/access");
    const result = await actual.requireDeploymentAdmin(new Request("http://localhost/api/deployment/status"));
    expect("error" in result && result.error?.status).toBe(403);
    expect(mocks.apiAuth).toHaveBeenCalledWith(expect.any(Request), "settings.manage");
  });
});
