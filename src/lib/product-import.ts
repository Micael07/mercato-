/**
 * Importação de produtos por planilha: leitura de CSV, reconhecimento de colunas e
 * validação linha a linha. Usado no navegador (pré-visualização) e no servidor (que revalida tudo).
 */

export const IMPORT_FIELDS = [
  { key: "name", label: "Descrição", required: true },
  { key: "salePrice", label: "Preço de venda", required: true },
  { key: "sku", label: "SKU / Código" },
  { key: "barcode", label: "Código de barras (EAN)" },
  { key: "category", label: "Categoria" },
  { key: "brand", label: "Marca" },
  { key: "unit", label: "Unidade" },
  { key: "costPrice", label: "Preço de custo" },
  { key: "stock", label: "Estoque inicial" },
  { key: "minStock", label: "Estoque mínimo" },
  { key: "maxStock", label: "Estoque máximo" },
  { key: "location", label: "Localização" },
  { key: "expiryDate", label: "Validade" },
  { key: "allowFractional", label: "Venda fracionada (peso)" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type RawImportRow = { line: number } & Partial<Record<ImportFieldKey, string>>;

export const MAX_IMPORT_ROWS = 5000;

const ALIASES: Record<ImportFieldKey, string[]> = {
  name: ["descricao", "descricao do produto", "produto", "nome", "nome do produto", "item", "description", "name"],
  salePrice: ["preco de venda", "preco venda", "preco", "valor", "valor de venda", "venda", "pvenda", "preco unitario", "price", "sale price"],
  sku: ["sku", "codigo", "cod", "codigo interno", "referencia", "ref", "codigo do produto", "cod produto", "id"],
  barcode: ["codigo de barras", "cod barras", "codbarras", "ean", "gtin", "ean13", "barras", "barcode", "cod de barras"],
  category: ["categoria", "grupo", "departamento", "secao", "setor", "category"],
  brand: ["marca", "fabricante", "brand"],
  unit: ["unidade", "un", "und", "unid", "medida", "unit"],
  costPrice: ["preco de custo", "custo", "preco custo", "valor de custo", "pcusto", "custo unitario", "cost"],
  stock: ["estoque", "estoque inicial", "quantidade", "qtd", "qtde", "saldo", "estoque atual", "stock"],
  minStock: ["estoque minimo", "minimo", "est minimo", "estoque min", "min"],
  maxStock: ["estoque maximo", "maximo", "est maximo", "estoque max", "max"],
  location: ["localizacao", "local", "prateleira", "corredor", "endereco", "location"],
  expiryDate: ["validade", "vencimento", "data de validade", "data validade", "vence em", "expiry"],
  allowFractional: ["fracionado", "venda fracionada", "peso", "pesavel", "balanca", "fracionavel"],
};

export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sugere para cada coluna da planilha o campo correspondente (sem repetir campo). */
export function detectMapping(headers: string[]): Array<ImportFieldKey | ""> {
  const used = new Set<ImportFieldKey>();
  const result: Array<ImportFieldKey | ""> = headers.map(() => "");
  const norm = headers.map(normalizeHeader);
  // 1ª passada: igualdade exata; 2ª: o cabeçalho contém o apelido.
  for (const pass of [0, 1]) {
    norm.forEach((h, i) => {
      if (result[i] || !h) return;
      for (const f of IMPORT_FIELDS) {
        if (used.has(f.key)) continue;
        const hit = ALIASES[f.key].some((a) => (pass === 0 ? h === a : a.length > 3 && h.includes(a)));
        if (hit) {
          result[i] = f.key;
          used.add(f.key);
          return;
        }
      }
    });
  }
  return result;
}

/** Lê texto CSV (separador ; , ou tab, aspas, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ";": 0, ",": 0, "\t": 0 } as Record<string, number>;
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = (Object.keys(counts) as string[]).sort((a, b) => counts[b] - counts[a])[0];
  const sep = counts[delim] > 0 ? delim : ";";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Aceita "1.234,56", "12,5", "R$ 10,00", "12.5", "0.500". */
export function parseNumber(input: string | undefined | null): number | null {
  if (input === undefined || input === null) return null;
  let s = String(input).trim().replace(/R\$|\s/g, "");
  if (s === "") return null;
  if (/^-?\d+([.,]\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s) && !s.startsWith("0.")) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDateStr(input: string | undefined | null): string | null | "invalid" {
  const s = String(input ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mt) {
    y = +mt[1];
    m = +mt[2];
    d = +mt[3];
  } else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    d = +mt[1];
    m = +mt[2];
    y = +mt[3] < 100 ? 2000 + +mt[3] : +mt[3];
  } else return "invalid";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "invalid";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const UNIT_ALIASES: Record<string, string> = {
  UNIDADE: "UN", UNID: "UN", UND: "UN", UNIDADES: "UN", QUILO: "KG", QUILOS: "KG", QUILOGRAMA: "KG", KILO: "KG",
  GRAMA: "G", GRAMAS: "G", LITRO: "L", LITROS: "L", LT: "L", LTS: "L", CAIXA: "CX", CAIXAS: "CX", PACOTE: "PCT",
  PACOTES: "PCT", PCTE: "PCT", METRO: "M", METROS: "M", MT: "M", PECA: "PC", PECAS: "PC", "PEÇA": "PC", "PEÇAS": "PC",
  FARDO: "FD", DUZIA: "DZ", "DÚZIA": "DZ", PAR: "PR", SACO: "SC", LATA: "LT", GARRAFA: "GF", FRASCO: "FR", BANDEJA: "BJ",
};
const FRACTIONAL_UNITS = new Set(["KG", "G", "L", "ML", "M", "MT"]);

export interface NormalizedProduct {
  line: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  costPrice: number | null;
  salePrice: number;
  stock: number | null;
  minStock: number | null;
  maxStock: number | null;
  location: string | null;
  expiryDate: string | null;
  allowFractional: boolean | null;
  /** quais campos vieram preenchidos (usado ao atualizar produtos existentes) */
  provided: Set<ImportFieldKey>;
}

export function normalizeImportRow(raw: RawImportRow): { value?: NormalizedProduct; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = (k: ImportFieldKey) => String(raw[k] ?? "").replace(/\s+/g, " ").trim();
  const provided = new Set<ImportFieldKey>();
  const has = (k: ImportFieldKey) => {
    const v = get(k);
    if (v !== "") provided.add(k);
    return v !== "";
  };

  const name = get("name");
  if (!name) errors.push("Descrição obrigatória.");
  else if (name.length > 220) errors.push("Descrição acima de 220 caracteres.");
  has("name");

  const money = (k: "costPrice" | "salePrice" | "stock" | "minStock" | "maxStock", label: string): number | null => {
    if (!has(k)) return null;
    const n = parseNumber(get(k));
    if (n === null) {
      errors.push(`${label} inválido: "${get(k)}".`);
      return null;
    }
    if (n < 0) {
      errors.push(`${label} não pode ser negativo.`);
      return null;
    }
    return n;
  };
  const salePrice = money("salePrice", "Preço de venda");
  if (salePrice === null && !errors.some((e) => e.startsWith("Preço de venda"))) errors.push("Preço de venda obrigatório.");
  else if (salePrice === 0) errors.push("Preço de venda deve ser maior que zero.");
  const costPrice = money("costPrice", "Preço de custo");
  const stock = money("stock", "Estoque inicial");
  const minStock = money("minStock", "Estoque mínimo");
  const maxStock = money("maxStock", "Estoque máximo");
  if (salePrice && costPrice !== null && costPrice > salePrice) warnings.push("Custo maior que o preço de venda.");

  let sku = get("sku");
  if (sku.length > 60) {
    errors.push("SKU acima de 60 caracteres.");
    sku = "";
  }
  has("sku");

  let barcode = get("barcode").replace(/^'/, "");
  if (barcode) {
    if (/e[+-]?\d/i.test(barcode) && /^[\d.,]+e/i.test(barcode)) {
      errors.push(`Código de barras em notação científica ("${barcode}"). Formate a coluna como Texto no Excel.`);
      barcode = "";
    } else if (barcode.length > 60) {
      errors.push("Código de barras acima de 60 caracteres.");
      barcode = "";
    } else if (/^\d+\.0+$/.test(barcode)) barcode = barcode.replace(/\.0+$/, "");
    has("barcode");
  }

  const clip = (k: ImportFieldKey, max: number, label: string) => {
    const v = get(k);
    if (!v) return null;
    provided.add(k);
    if (v.length > max) {
      errors.push(`${label} acima de ${max} caracteres.`);
      return null;
    }
    return v;
  };
  const category = clip("category", 120, "Categoria");
  const brand = clip("brand", 100, "Marca");
  const location = clip("location", 80, "Localização");

  let unit = "UN";
  if (has("unit")) {
    const u = get("unit").toLocaleUpperCase("pt-BR");
    unit = UNIT_ALIASES[u] ?? u;
    if (unit.length > 12) {
      errors.push("Unidade acima de 12 caracteres.");
      unit = "UN";
    }
  }

  let expiryDate: string | null = null;
  if (has("expiryDate")) {
    const d = parseDateStr(get("expiryDate"));
    if (d === "invalid") errors.push(`Validade inválida: "${get("expiryDate")}" (use dd/mm/aaaa).`);
    else expiryDate = d;
  }

  let allowFractional: boolean | null = null;
  if (has("allowFractional")) {
    const v = normalizeHeader(get("allowFractional"));
    if (["sim", "s", "1", "true", "x", "yes", "y", "verdadeiro"].includes(v)) allowFractional = true;
    else if (["nao", "n", "0", "false", "no", "falso"].includes(v)) allowFractional = false;
    else errors.push(`Venda fracionada deve ser Sim ou Não (recebido "${get("allowFractional")}").`);
  }
  if (allowFractional === null && FRACTIONAL_UNITS.has(unit)) allowFractional = true;
  if (allowFractional === false && stock !== null && !Number.isInteger(stock)) warnings.push("Estoque fracionado em produto de venda inteira.");

  if (errors.length) return { errors, warnings };
  return {
    errors,
    warnings,
    value: {
      line: raw.line, name, sku: sku || null, barcode: barcode || null, category, brand, unit,
      costPrice, salePrice: salePrice as number, stock, minStock, maxStock, location, expiryDate, allowFractional, provided,
    },
  };
}

export function categoryKey(name: string): string {
  return normalizeHeader(name);
}

export const TEMPLATE_HEADERS = ["Descrição", "SKU", "Código de barras", "Categoria", "Marca", "Unidade", "Preço de custo", "Preço de venda", "Estoque inicial", "Estoque mínimo", "Validade"];
export const TEMPLATE_ROWS = [
  ["Arroz Tipo 1 5kg", "ARR-5K", "7891000100101", "Mercearia", "Tio Joao", "UN", "24,50", "32,90", "40", "10", ""],
  ["Queijo Mussarela kg", "QJ-MUS", "", "Frios", "", "KG", "32,00", "44,90", "12,5", "3", "30/12/2026"],
];
