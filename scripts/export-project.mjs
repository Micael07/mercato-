import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceArchive } from "../src/lib/deployment/export-source.ts";

// Node.js 22.18+ executes this erasable TypeScript module natively.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const archive = await createSourceArchive(root);
  const directory = path.join(root, "exports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "mercato-publicacao.zip");
  await writeFile(file, archive.bytes, { mode: 0o600 });
  console.log(`Pacote: exports/mercato-publicacao.zip (${archive.manifest.entries.length} arquivos).`);
  console.log("Não contém banco de dados ou arquivos de ambiente. Não houve deploy nem migração.");
  console.log("Extraia a pasta mercato e siga docs/PUBLICACAO.md. Revise o conteúdo antes de compartilhar.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Não foi possível gerar o pacote.");
  process.exitCode = 1;
}
