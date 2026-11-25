import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connection = process.env.MIGRATION_TEST_DATABASE_URL;
const runner = fileURLToPath(new URL("../scripts/apply-migrations.mjs", import.meta.url));

function execute() {
  return spawnSync(process.execPath, [runner], {
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: connection,
      MIGRATION_ENV_FILE: "/tmp/mercato-no-test-env-file",
    },
    encoding: "utf8",
    timeout: 60000,
  });
}

test("migrations: banco limpo, repetição, histórico e checksum", {
  skip: !connection && "Defina MIGRATION_TEST_DATABASE_URL para um banco descartável vazio.",
  timeout: 180000,
}, async () => {
  const url = new URL(connection);
  assert.match(url.pathname, /test/i, "O banco descartável precisa conter test no nome.");
  const client = new pg.Client({ connectionString: connection });
  await client.connect();
  try {
    const initial = await client.query("SELECT to_regclass('public.companies') AS name");
    assert.equal(initial.rows[0].name, null, "Use um banco vazio; não execute contra dados existentes.");

    const first = execute();
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /6 nova\(s\), 0 já registrada/);
    const recorded = await client.query("SELECT name, checksum FROM mercato_meta.schema_migrations ORDER BY name");
    assert.equal(recorded.rows.length, 6);
    assert.equal((await client.query("SELECT count(*)::integer AS total FROM public.users")).rows[0].total, 0);

    const second = execute();
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /0 nova\(s\), 6 já registrada/);
    assert.equal((second.stdout.match(/Já aplicada:/g) || []).length, 6);

    const last = recorded.rows.at(-1);
    await client.query("UPDATE mercato_meta.schema_migrations SET checksum=$1 WHERE name=$2", ["0".repeat(64), last.name]);
    try {
      const mismatch = execute();
      assert.equal(mismatch.status, 1);
      assert.match(mismatch.stderr, /Checksum divergente/);
    } finally {
      await client.query("UPDATE mercato_meta.schema_migrations SET checksum=$1 WHERE name=$2", [last.checksum, last.name]);
    }

    const final = execute();
    assert.equal(final.status, 0, `${final.stdout}\n${final.stderr}`);
    assert.equal((await client.query("SELECT count(*)::integer AS total FROM mercato_meta.schema_migrations")).rows[0].total, 6);
  } finally {
    await client.end();
  }
});
