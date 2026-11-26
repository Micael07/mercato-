import { unzipSync, strFromU8 } from "fflate";

/**
 * Leitor mínimo de .xlsx (primeira planilha) para a importação de produtos.
 * Entende texto compartilhado, texto em linha, números e datas; ignora fórmulas além do valor guardado.
 */

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml: string) =>
  [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

const colIndex = (ref: string) => {
  const letters = (ref.match(/^[A-Z]+/) ?? [""])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function readXlsxRows(data: Uint8Array): string[][] {
  const files = unzipSync(data);
  const get = (name: string) => (files[name] ? strFromU8(files[name]) : null);

  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new Error("Arquivo .xlsx inválido.");
  const rid = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  let target = "worksheets/sheet1.xml";
  if (rid) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (new RegExp(`Id="${rid}"`).test(m[1])) {
        const t = m[1].match(/Target="([^"]+)"/)?.[1];
        if (t) target = t.replace(/^\/?(xl\/)?/, "");
      }
    }
  }
  const sheet = get(`xl/${target}`);
  if (!sheet) throw new Error("Não foi possível ler a primeira planilha do arquivo.");

  const shared = (get("xl/sharedStrings.xml") ?? "")
    ? [...(get("xl/sharedStrings.xml") as string).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];

  // Quais estilos de célula são datas
  const dateStyle = new Set<number>();
  const styles = get("xl/styles.xml");
  if (styles) {
    const customDate = new Set<number>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
      if (/[dmy]/i.test(m[2].replace(/\[[^\]]*\]|"[^"]*"/g, ""))) customDate.add(Number(m[1]));
    }
    const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
    [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].forEach((m, i) => {
      const id = Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
      if (BUILTIN_DATE_IDS.has(id) || customDate.has(id)) dateStyle.add(i);
    });
  }

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIndex(ref) : row.length;
      const type = attrs.match(/\bt="(\w+)"/)?.[1] ?? "n";
      const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str" && v !== undefined) value = decodeXml(v);
      else if (type === "b" && v !== undefined) value = v === "1" ? "Sim" : "Não";
      else if (v !== undefined) {
        const n = Number(v);
        if (dateStyle.has(style) && Number.isFinite(n)) value = serialToIso(n);
        else if (Number.isFinite(n)) value = Number.isInteger(n) ? n.toFixed(0) : String(n);
        else value = decodeXml(v);
      }
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c ?? "").trim() !== "")).map((r) => r.map((c) => c ?? ""));
}
