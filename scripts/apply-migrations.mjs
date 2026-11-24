import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Existing environment variables take precedence over the ignored local file.
config({
  path: process.env.MIGRATION_ENV_FILE || path.join(projectRoot, ".env.migrations.local"),
  quiet: true,
});

function connectionOptions(value) {
  if (!value) throw new Error("Defina MIGRATION_DATABASE_URL (variável do host ou .env.migrations.local).");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A conexão PostgreSQL informada não é uma URL válida.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Use uma conexão postgresql:// fornecida pelo banco.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (!local) {
    const mode = url.searchParams.get("sslmode");
    if (["disable", "no-verify", "prefer", "allow"].includes(mode)) {
      throw new Error("Migrations remotas exigem TLS com validação de certificado.");
    }
    // Do not turn off certificate or hostname verification for hosted databases.
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.delete("uselibpqcompat");
  }
  return {
    connectionString: url.toString(),
    connectionTimeoutMillis: 15000,
    application_name: "mercato-migrations",
  };
}

let client;
let locked = false;
try {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  client = new pg.Client(connectionOptions(url));
  await client.connect();

  // Use the direct/session connection: a transaction pooler cannot retain this lock.
  await client.query("SELECT pg_advisory_lock(hashtext('mercato-schema-migrations'))");
  locked = true;
  await client.query("CREATE SCHEMA IF NOT EXISTS mercato_meta");
  await client.query(`
    CREATE TABLE IF NOT EXISTS mercato_meta.schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const directory = path.join(projectRoot, "supabase", "migrations");
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  if (files.length === 0) throw new Error("Nenhuma migration SQL encontrada.");

  const recorded = await client.query(
    "SELECT name, checksum FROM mercato_meta.schema_migrations ORDER BY name"
  );
  const applied = new Map(recorded.rows.map((row) => [row.name, row.checksum]));

  const existing = await client.query("SELECT to_regclass('public.companies') AS name");
  if (existing.rows[0].name && !applied.has(files[0])) {
    throw new Error(
      "Banco existente sem histórico deste executor. Interrompido para preservar seus dados. " +
      "Use um banco vazio para o primeiro deploy ou faça baseline revisada com backup; não apague tabelas."
    );
  }
  for (const name of applied.keys()) {
    if (!files.includes(name)) {
      throw new Error(`Migration aplicada ausente no repositório: ${name}. Restaure o arquivo original.`);
    }
  }

  const migrations = [];
  for (const name of files) {
    const text = await readFile(path.join(directory, name), "utf8");
    // Keep checksums stable across Windows/Linux line endings.
    const checksum = createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
    if (applied.has(name) && applied.get(name) !== checksum) {
      throw new Error(`Checksum divergente em ${name}. Não modifique migrations já aplicadas.`);
    }
    migrations.push({ name, text, checksum });
  }

  const fn = await client.query("SELECT to_regprocedure('auth.uid()') AS name");
  if (!fn.rows[0].name) {
    await client.query("CREATE SCHEMA IF NOT EXISTS auth");
    await client.query(`
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULL::uuid $$
    `);
    console.log("auth.uid(): compatibilidade SQL criada (retorna NULL; não é autenticação Supabase).");
  }

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      console.log(`Já aplicada: ${migration.name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '15s'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      await client.query(migration.text);
      await client.query(
        "INSERT INTO mercato_meta.schema_migrations (name, checksum) VALUES ($1, $2)",
        [migration.name, migration.checksum]
      );
      await client.query("COMMIT");
      count += 1;
      console.log(`Aplicada: ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      // PostgreSQL details can contain row values; don't print connection strings or query data.
      throw new Error(
        `Falha em ${migration.name} (SQLSTATE ${error.code || "desconhecido"}). ` +
        "A migration atual foi revertida. Consulte o log privado do banco."
      );
    }
  }
  console.log(`Concluído: ${count} nova(s), ${applied.size} já registrada(s). Nenhum seed executado.`);
} catch (error) {
  // All application-created messages are credential-free; network errors are mapped here.
  const message = error instanceof Error ? error.message : "Falha desconhecida.";
  const safe = /Defina |URL válida|Use uma conexão|TLS |Nenhuma migration|Banco existente|Migration aplicada|Checksum divergente|Falha em /.test(message);
  console.error(safe ? message : "Falha ao conectar/aplicar migrations. Confira a URL, o acesso de rede e o certificado TLS.");
  process.exitCode = 1;
} finally {
  if (client) {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock(hashtext('mercato-schema-migrations'))").catch(() => {});
    }
    await client.end().catch(() => {});
  }
}
