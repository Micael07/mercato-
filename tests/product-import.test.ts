import { describe, it, expect } from "vitest";
import { detectMapping, normalizeImportRow, parseCsv, parseDateStr, parseNumber } from "@/lib/product-import";

describe("importação de produtos — leitura", () => {
  it("lê números no formato brasileiro e internacional", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("R$ 12,50")).toBe(12.5);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("0.500")).toBe(0.5);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("lê datas dd/mm/aaaa e ISO e recusa datas impossíveis", () => {
    expect(parseDateStr("05/12/2026")).toBe("2026-12-05");
    expect(parseDateStr("2026-12-05")).toBe("2026-12-05");
    expect(parseDateStr("5/1/27")).toBe("2027-01-05");
    expect(parseDateStr("31/02/2026")).toBe("invalid");
    expect(parseDateStr("")).toBeNull();
  });

  it("detecta separador, aspas e BOM no CSV", () => {
    const a = parseCsv('﻿Descrição;Preço\r\n"Arroz; tipo 1";"10,50"\r\n\r\nFeijão;8,00');
    expect(a).toEqual([["Descrição", "Preço"], ["Arroz; tipo 1", "10,50"], ["Feijão", "8,00"]]);
    const b = parseCsv("nome,preco\nLeite,5.5\n");
    expect(b[1]).toEqual(["Leite", "5.5"]);
    const c = parseCsv('a;b\n"diz ""oi""";2');
    expect(c[1][0]).toBe('diz "oi"');
  });

  it("reconhece cabeçalhos comuns sem repetir campo", () => {
    const m = detectMapping(["Código", "Produto", "EAN", "Grupo", "Preço Custo", "Preço Venda", "Qtd", "Vencimento", "Obs"]);
    expect(m).toEqual(["sku", "name", "barcode", "category", "costPrice", "salePrice", "stock", "expiryDate", ""]);
  });
});

describe("importação de produtos — validação", () => {
  const base = { line: 2, name: "Arroz 5kg", salePrice: "32,90" };

  it("aceita linha mínima e aplica padrões", () => {
    const r = normalizeImportRow(base);
    expect(r.errors).toEqual([]);
    expect(r.value?.unit).toBe("UN");
    expect(r.value?.salePrice).toBe(32.9);
    expect(r.value?.sku).toBeNull();
  });

  it("exige descrição e preço de venda maior que zero", () => {
    expect(normalizeImportRow({ line: 2, name: "", salePrice: "1" }).errors.join()).toMatch(/Descrição/);
    expect(normalizeImportRow({ line: 2, name: "x" }).errors.join()).toMatch(/Preço de venda obrigatório/);
    expect(normalizeImportRow({ line: 2, name: "x", salePrice: "0" }).errors.join()).toMatch(/maior que zero/);
    expect(normalizeImportRow({ line: 2, name: "x", salePrice: "abc" }).errors.join()).toMatch(/inválido/);
  });

  it("recusa negativos, validade ruim e EAN em notação científica", () => {
    expect(normalizeImportRow({ ...base, stock: "-3" }).errors.join()).toMatch(/negativo/);
    expect(normalizeImportRow({ ...base, expiryDate: "99/99/2026" }).errors.join()).toMatch(/Validade/);
    expect(normalizeImportRow({ ...base, barcode: "7,89E+12" }).errors.join()).toMatch(/notação científica/);
  });

  it("normaliza unidade, fracionado por peso e avisa custo acima do preço", () => {
    const kg = normalizeImportRow({ ...base, unit: "quilo" });
    expect(kg.value?.unit).toBe("KG");
    expect(kg.value?.allowFractional).toBe(true);
    const w = normalizeImportRow({ ...base, costPrice: "40,00" });
    expect(w.warnings.join()).toMatch(/Custo maior/);
    expect(normalizeImportRow({ ...base, allowFractional: "talvez" }).errors.join()).toMatch(/Sim ou Não/);
  });

  it("registra quais campos vieram preenchidos", () => {
    const r = normalizeImportRow({ ...base, brand: "X", category: "" });
    expect(r.value?.provided.has("brand")).toBe(true);
    expect(r.value?.provided.has("category")).toBe(false);
  });
});

import { zipSync, strToU8 } from "fflate";
import { readXlsxRows } from "@/lib/xlsx-read";

function miniXlsx() {
  const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Pre&#231;o</t></is></c><c r="C1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t></t></is></c><c r="B2"><v>12.5</v></c><c r="D2" s="1"><v>46023</v></c></row>
</sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8("<sst><si><t>Produto</t></si><si><r><t>EA</t></r><r><t>N</t></r></si></sst>"),
    "xl/styles.xml": strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}

describe("leitor de .xlsx", () => {
  it("lê texto compartilhado, texto em linha vazio, números e datas", () => {
    const rows = readXlsxRows(miniXlsx());
    expect(rows[0]).toEqual(["Produto", "Preço", "EAN"]);
    expect(rows[1]).toEqual(["", "12.5", "", "2026-01-01"]);
  });
});
