import "dotenv/config";
import { afterEach, describe, expect, it, vi } from "vitest";

async function getHeaders() {
  vi.resetModules();
  const { default: configuration } = await import("../next.config");
  if (!configuration.headers) throw new Error("Cabeçalhos não configurados.");
  const entries = await configuration.headers();
  return entries.find((entry) => entry.source === "/(.*)")?.headers ?? [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Publicação: fronteiras de configuração", () => {
  it("modo público proíbe iframe e não libera unsafe-eval", async () => {
    vi.stubEnv("DEPLOYMENT_TARGET", "public");
    const headers = await getHeaders();
    expect(headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("preview preserva enquadramento da plataforma sem X-Frame-Options DENY", async () => {
    vi.stubEnv("DEPLOYMENT_TARGET", "preview");
    const headers = await getHeaders();
    expect(headers.find((h) => h.key === "X-Frame-Options")).toBeUndefined();
    expect(headers.find((h) => h.key === "Content-Security-Policy")?.value).toContain("frame-ancestors *");
  });

  it("API de cadastro fechado recusa antes de consultar ou escrever dados", async () => {
    vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", "false");
    const { POST } = await import("../src/app/api/auth/register/route");
    const result = await POST(new Request("http://localhost/api/auth/register", { method: "POST" }));
    expect(result.status).toBe(403);
    expect((await result.json()).error).toContain("cadastros estão fechados");
  });

  it("login público não habilita demo mesmo com a flag de demonstração ligada", async () => {
    vi.stubEnv("DEPLOYMENT_TARGET", "public");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO", "true");
    vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", "false");
    const { default: LoginPage } = await import("../src/app/(auth)/login/page");
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    expect(page.props.demoEnabled).toBe(false);
    expect(page.props.registrationEnabled).toBe(false);
  });
});
