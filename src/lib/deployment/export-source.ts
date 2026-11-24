import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";

const ROOT_FILES = [
  "package.json", "package-lock.json", ".gitignore", ".node-version", ".env.example",
  "next.config.ts", "next-env.d.ts", "tsconfig.json", "postcss.config.mjs",
  "eslint.config.mjs", "vitest.config.ts", "vitest.config.mts", "playwright.config.ts", "render.yaml",
  "railway.json", "drizzle.config.json", "README.md",
];
const SOURCE_DIRECTORIES = ["src", "scripts", "tests", "e2e", "docs", "supabase/migrations", "public/brand"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".cjs", ".js", ".json", ".css", ".md", ".txt", ".sql", ".yaml", ".yml", ".svg"]);
const BLOCKED_DIRECTORIES = new Set(["node_modules", ".git", ".next", ".vercel", "exports", "backups", "uploads", "coverage", ".cache", "test-results", "playwright-report", ".auth"]);
const MAX_FILES = 2500;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

export interface ExportManifest {
  format: 1;
  generatedAt: string;
  purpose: string;
  containsDatabase: false;
  entries: Array<{ path: string; bytes: number; sha256: string }>;
  reviewRequired: string;
}

function permitted(relative: string): boolean {
  const segments = relative.split("/");
  if (relative.startsWith("/") || relative.includes("\\") || relative.includes(":") || segments.includes("..")) return false;
  if (segments.some((part) => BLOCKED_DIRECTORIES.has(part))) return false;
  if (relative === ".env.example") return true;
  const base = segments.at(-1) || "";
  if (base.startsWith(".env") || /(?:^|[._-])(credentials|secrets|backup|dump)(?:[._-]|$)/i.test(base)) return false;
  if (ROOT_FILES.includes(relative)) return true;
  return EXTENSIONS.has(path.posix.extname(base));
}

async function safeFile(root: string, relative: string) {
  // Check every path segment to avoid following a directory symlink.
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Não foi possível inspecionar os arquivos de exportação.");
    }
  }
  const info = await lstat(current);
  if (!info.isFile()) return null;
  if (info.size > MAX_FILE_BYTES) throw new Error("Há um arquivo acima do limite de exportação. Revise o projeto localmente.");
  return { absolute: current, size: info.size };
}

export async function createSourceArchive(projectRoot: string): Promise<{
  bytes: Uint8Array;
  manifest: ExportManifest;
}> {
  const root = path.resolve(projectRoot);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Raiz de exportação inválida.");
  }
  const files = new Set<string>();
  for (const file of ROOT_FILES) {
    if (await safeFile(root, file)) files.add(file);
  }
  async function walk(relative: string): Promise<void> {
    let entries;
    try {
      // Directory roots themselves may be links (e.g. scripts -> /private).
      let current = root;
      for (const part of relative.split("/")) {
        current = path.join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) return;
      }
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("Não foi possível ler uma pasta de exportação.");
    }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink() || child.split("/").some((part) => BLOCKED_DIRECTORIES.has(part))) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && permitted(child)) {
        files.add(child);
        if (files.size > MAX_FILES) throw new Error("Quantidade de arquivos acima do limite de exportação.");
      }
    }
  }
  for (const directory of SOURCE_DIRECTORIES) await walk(directory);
  for (const required of ["package.json", "package-lock.json", "render.yaml", "src/app/layout.tsx"]) {
    if (!files.has(required)) throw new Error("Projeto incompleto para exportação. Use os arquivos originais no editor.");
  }

  const manifest: ExportManifest = {
    format: 1,
    generatedAt: new Date().toISOString(),
    purpose: "Código-fonte para homologação; não publica automaticamente.",
    containsDatabase: false,
    entries: [],
    reviewRequired: "Revise os arquivos antes de compartilhar. A seleção exclui arquivos de ambiente e backups, mas não prova ausência de segredos inseridos manualmente em código-fonte.",
  };
  const archive: Zippable = Object.create(null);
  let total = 0;
  for (const relative of [...files].sort()) {
    if (!permitted(relative)) continue;
    const file = await safeFile(root, relative);
    if (!file) continue;
    const content = await readFile(file.absolute);
    if (content.byteLength > MAX_FILE_BYTES) throw new Error("Um arquivo mudou durante a exportação. Tente novamente.");
    total += content.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error("Tamanho total acima do limite de exportação.");
    manifest.entries.push({ path: relative, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") });
    archive[`mercato/${relative}`] = content;
  }
  archive["mercato/PUBLICACAO-MANIFESTO.json"] = strToU8(JSON.stringify(manifest, null, 2));
  archive["mercato/LEIA-PRIMEIRO.txt"] = strToU8([
    "Mercato — pacote de código para homologação",
    "",
    "1. Extraia a pasta mercato e abra docs/PUBLICACAO.md (passo a passo pensado para tablet, sem computador).",
    "2. Envie o código a um GitHub privado (Codespaces no navegador) e publique no Render com o render.yaml.",
    "3. Crie o banco Neon próprio; as migrations rodam sozinhas a cada deploy.",
    "4. Não reutilize contas, senhas temporárias ou banco deste preview.",
    "",
    "Este arquivo não contém o banco de dados, .env, backups, uploads ou node_modules.",
    "O manifesto lista os arquivos selecionados e seus hashes SHA-256.",
    "Revise código e documentação antes de compartilhar: segredos inseridos manualmente no código exigem revisão própria.",
    "Não é aprovação para uso comercial. Consulte docs/CHECKLIST_PRODUCAO.md.",
  ].join("\n"));
  return { bytes: zipSync(archive, { level: 4 }), manifest };
}
