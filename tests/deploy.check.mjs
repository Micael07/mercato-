import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDeployment } from "../scripts/check-deploy.mjs";

const valid = {
  AUTH_SECRET: "deploy-test-only-".repeat(4),
  DATABASE_URL: "postgresql://example:example@db.example.invalid/neondb?sslmode=verify-full",
  MIGRATION_DATABASE_URL: "postgresql://example:example@db.example.invalid/neondb?sslmode=verify-full",
  PLATFORM_ADMIN_EMAILS: "dono@example.invalid",
  DEPLOYMENT_TARGET: "public",
  ALLOW_DEV_SEED: "false",
  NEXT_PUBLIC_ENABLE_DEMO: "false",
  ALLOW_PUBLIC_REGISTRATION: "true",
};

test("configuração pública completa é aceita sem conexão de rede", () => {
  assert.deepEqual(validateDeployment(valid), []);
});

test("segredo ausente, curto ou de exemplo é recusado", () => {
  for (const secret of [undefined, "short", "change-me-".repeat(8)]) {
    assert.ok(validateDeployment({ ...valid, AUTH_SECRET: secret }).some((x) => x.includes("AUTH_SECRET")));
  }
});

test("banco local e TLS sem verificação são recusados no deploy remoto", () => {
  for (const connection of [
    "postgresql://example:example@127.0.0.1/test?sslmode=verify-full",
    "postgresql://example:example@db.example.invalid/test?sslmode=no-verify",
    "postgresql://example:example@db.example.invalid/test?sslmode=require",
    "https://example.invalid",
  ]) {
    assert.ok(validateDeployment({ ...valid, DATABASE_URL: connection }).length > 0);
  }
});

test("migrations exigem conexão direta e o e-mail do dono da plataforma", () => {
  for (const patch of [
    { MIGRATION_DATABASE_URL: undefined },
    { MIGRATION_DATABASE_URL: "postgresql://example:example@ep-x-pooler.example.invalid/neondb?sslmode=verify-full" },
    { PLATFORM_ADMIN_EMAILS: undefined },
    { PLATFORM_ADMIN_EMAILS: "nao-e-email" },
  ]) {
    assert.ok(validateDeployment({ ...valid, ...patch }).length > 0);
  }
});

test("demo, seed e modo preview são recusados no deploy público", () => {
  for (const patch of [
    { ALLOW_DEV_SEED: "true" },
    { NEXT_PUBLIC_ENABLE_DEMO: "true" },
    { ALLOW_SOURCE_EXPORT: "true" },
    { DEPLOYMENT_TARGET: "preview" },
    { ALLOW_PUBLIC_REGISTRATION: undefined },
  ]) {
    assert.ok(validateDeployment({ ...valid, ...patch }).length > 0);
  }
});

test("é possível fechar o cadastro sem invalidar a configuração", () => {
  assert.deepEqual(validateDeployment({ ...valid, ALLOW_PUBLIC_REGISTRATION: "false" }), []);
});

test("mensagens de validação não revelam URL nem segredo", () => {
  const secret = "sensitive-value-should-not-appear";
  const url = "postgresql://account:private-password@db.example.invalid/test?sslmode=disable";
  const errors = validateDeployment({ ...valid, AUTH_SECRET: secret, DATABASE_URL: url }).join(" ");
  assert.ok(!errors.includes(secret));
  assert.ok(!errors.includes("private-password"));
  assert.ok(!errors.includes(url));
});

test("Railway usa Railpack e startCommand no bloco deploy", async () => {
  const settings = JSON.parse(await readFile(new URL("../railway.json", import.meta.url), "utf8"));
  assert.equal(settings.build.builder, "RAILPACK");
  assert.equal(settings.build.startCommand, undefined);
  assert.ok(settings.deploy.startCommand.startsWith("npm start"));
  assert.equal(settings.deploy.healthcheckPath, "/api/health");
});

test("Blueprint não cria banco Render expirável e desativa demo/seed", async () => {
  const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /generateValue: true/);
  assert.match(blueprint, /key: ALLOW_DEV_SEED\s+value: "false"/);
  assert.match(blueprint, /key: NEXT_PUBLIC_ENABLE_DEMO\s+value: "false"/);
  assert.ok(!blueprint.includes("databases:"));
});

test("arquivos de ambiente e backups estão na lista de ignore", async () => {
  const ignored = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignored, /^\.env\*$/m);
  assert.match(ignored, /^!\.env\.example$/m);
  assert.match(ignored, /^\*\.dump$/m);
});
