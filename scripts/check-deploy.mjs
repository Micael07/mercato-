import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function validateDeployment(env) {
  const errors = [];
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || /change-me|your[-_ ]?secret|seu[-_ ]?segredo/i.test(env.AUTH_SECRET)) {
    errors.push("AUTH_SECRET precisa ser aleatório, exclusivo e ter pelo menos 32 caracteres.");
  }
  try {
    const url = new URL(env.DATABASE_URL || "");
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      errors.push("DATABASE_URL não pode apontar para seu computador no deploy remoto.");
    }
    if (url.searchParams.get("sslmode") !== "verify-full") {
      errors.push("Use sslmode=verify-full na DATABASE_URL pública para verificar o certificado do banco.");
    }
  } catch {
    errors.push("Defina DATABASE_URL com a URL PostgreSQL completa fornecida pelo provedor.");
  }
  try {
    const direct = new URL(env.MIGRATION_DATABASE_URL || "");
    if (!["postgres:", "postgresql:"].includes(direct.protocol)) throw new Error();
    if (direct.hostname.includes("-pooler")) {
      errors.push("MIGRATION_DATABASE_URL deve ser a conexão DIRETA (sem -pooler) do mesmo banco.");
    }
    if (direct.searchParams.get("sslmode") !== "verify-full") {
      errors.push("Use sslmode=verify-full também na MIGRATION_DATABASE_URL.");
    }
  } catch {
    errors.push("Defina MIGRATION_DATABASE_URL com a conexão direta do banco; ela aplica as migrations a cada deploy.");
  }
  const owners = String(env.PLATFORM_ADMIN_EMAILS || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (owners.length === 0 || owners.some((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) {
    errors.push("Defina PLATFORM_ADMIN_EMAILS com o seu e-mail: só ele libera o acesso dos clientes.");
  }
  if (env.DEPLOYMENT_TARGET !== "public") {
    errors.push("DEPLOYMENT_TARGET deve ser public no site publicado.");
  }
  if (env.ALLOW_DEV_SEED !== "false") {
    errors.push("ALLOW_DEV_SEED deve ser false no site publicado.");
  }
  if (env.NEXT_PUBLIC_ENABLE_DEMO !== "false") {
    errors.push("NEXT_PUBLIC_ENABLE_DEMO deve ser false no build público.");
  }
  if (env.ALLOW_SOURCE_EXPORT === "true") {
    errors.push("ALLOW_SOURCE_EXPORT não deve estar habilitada no serviço público.");
  }
  if (!["true", "false"].includes(env.ALLOW_PUBLIC_REGISTRATION)) {
    errors.push("Defina ALLOW_PUBLIC_REGISTRATION: true para cadastro inicial; false para fechá-lo.");
  }
  return errors;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const errors = validateDeployment(process.env);
  if (errors.length) {
    console.error("Configuração de deploy incompleta:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Configuração pública validada (sem exibir credenciais). Conectividade e migrations devem ser verificadas separadamente.");
  }
}
