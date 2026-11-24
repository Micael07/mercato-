import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { createSourceArchive } from "@/lib/deployment/export-source";
import { canExportSource, environmentChecks } from "@/lib/deployment/model";

const temporary: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mercato-export-test-"));
  temporary.push(directory);
  const root = path.join(directory, "project");
  await mkdir(path.join(root, "src", "app"), { recursive: true });
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "docs"));
  await mkdir(path.join(root, "public", "brand"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"name":"export-fixture"}'),
    writeFile(path.join(root, "package-lock.json"), '{"name":"export-fixture","lockfileVersion":3}'),
    writeFile(path.join(root, "render.yaml"), "services: []\n"),
    writeFile(path.join(root, "src", "app", "layout.tsx"), "export default function Layout() { return null; }"),
    writeFile(path.join(root, ".env.example"), 'AUTH_SECRET=""\n'),
    writeFile(path.join(root, "docs", "PUBLICACAO.md"), "# Publicação de homologação\n"),
    writeFile(path.join(root, "public", "brand", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
  ]);
  return { root, directory };
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Pacote de publicação", () => {
  it("inclui fontes e manifesto sem env, backups, uploads ou dependências", async () => {
    const { root } = await fixture();
    const marker = "PRIVATE_DATA_NOT_FOR_EXPORT_73429";
    for (const directory of ["exports", "backups", "node_modules", "public/uploads", "src/uploads", "scripts/node_modules"]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, "private.json"), marker);
    }
    for (const file of [".env", ".env.local", ".env.migrations.local", "docs/.env.production", "scripts/secrets.json", "scripts/credentials.json", "docs/backup.txt", "scripts/private.key"]) {
      await writeFile(path.join(root, file), marker);
    }
    if (process.platform !== "win32") {
      await writeFile(path.join(root, "src", "..\\..\\outside.ts"), marker);
    }
    const result = await createSourceArchive(root);
    const unpacked = unzipSync(result.bytes);
    const names = Object.keys(unpacked);
    expect(names.some((name) => name.includes("\\") || name.includes(":"))).toBe(false);
    expect(names).toContain("mercato/package.json");
    expect(names).toContain("mercato/package-lock.json");
    expect(names).toContain("mercato/.env.example");
    expect(names).toContain("mercato/LEIA-PRIMEIRO.txt");
    expect(names).toContain("mercato/PUBLICACAO-MANIFESTO.json");
    expect(names.some((name) => name.includes("node_modules") || name.includes("backups/") || name.includes("uploads/"))).toBe(false);
    expect(Object.values(unpacked).map((content) => strFromU8(content)).join("\n")).not.toContain(marker);
    for (const entry of result.manifest.entries) {
      expect(createHash("sha256").update(unpacked[`mercato/${entry.path}`]).digest("hex")).toBe(entry.sha256);
    }
    expect(result.manifest.containsDatabase).toBe(false);
  });

  it.skipIf(process.platform === "win32")("não segue links simbólicos de arquivos ou de pastas", async () => {
    const { root, directory } = await fixture();
    const outside = path.join(directory, "private.ts");
    await writeFile(outside, "PRIVATE_SYMLINK_TARGET_99271");
    await symlink(outside, path.join(root, "src", "leak.ts"));
    await symlink(directory, path.join(root, "scripts", "external"));
    const result = await createSourceArchive(root);
    const unpacked = unzipSync(result.bytes);
    expect(Object.keys(unpacked).some((name) => name.includes("leak.ts") || name.includes("external/"))).toBe(false);
    expect(Object.values(unpacked).map((content) => strFromU8(content)).join("\n")).not.toContain("PRIVATE_SYMLINK_TARGET_99271");
  });

  it("recusa projeto incompleto sem gerar um pacote enganoso", async () => {
    const { root } = await fixture();
    await rm(path.join(root, "package-lock.json"));
    await expect(createSourceArchive(root)).rejects.toThrow("Projeto incompleto");
  });

  it("recusa um arquivo acima do limite de tamanho", async () => {
    const { root } = await fixture();
    await writeFile(path.join(root, "src", "large.ts"), Buffer.alloc(3 * 1024 * 1024 + 1, 65));
    await expect(createSourceArchive(root)).rejects.toThrow("acima do limite");
  });
});

describe("Diagnóstico sem credenciais", () => {
  it("exportação exige preview explícito e flag explícita", () => {
    expect(canExportSource({})).toBe(false);
    expect(canExportSource({ DEPLOYMENT_TARGET: "public", ALLOW_SOURCE_EXPORT: "true" })).toBe(false);
    expect(canExportSource({ ALLOW_SOURCE_EXPORT: "true" })).toBe(false);
    expect(canExportSource({ DEPLOYMENT_TARGET: "preview", ALLOW_SOURCE_EXPORT: "false" })).toBe(false);
    expect(canExportSource({ DEPLOYMENT_TARGET: "preview", ALLOW_SOURCE_EXPORT: "true" })).toBe(true);
  });

  it("checklist não contém o segredo, o usuário, a senha ou a URL do banco", () => {
    const env = {
      AUTH_SECRET: "SENSITIVE_SESSION_MARKER_".repeat(3),
      DATABASE_URL: "postgresql://private-user:private-db-password@hidden-host.example/test?sslmode=verify-full",
      DEPLOYMENT_TARGET: "public",
      ALLOW_PUBLIC_REGISTRATION: "false",
    };
    const serialized = JSON.stringify(environmentChecks(env));
    expect(serialized).not.toContain(env.AUTH_SECRET);
    expect(serialized).not.toContain(env.DATABASE_URL);
    expect(serialized).not.toContain("private-db-password");
    expect(serialized).not.toContain("hidden-host.example");
    expect(environmentChecks(env).find((check) => check.id === "session-secret")?.state).toBe("ok");
  });
});
