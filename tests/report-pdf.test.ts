import { describe, it, expect } from "vitest";
import { buildReportPdf, isLandscape } from "../src/lib/report-pdf";

const base = {
  company: "Mercadinho Bom Preço", cnpj: "12.345.678/0001-90", establishment: "Loja Centro",
  title: "Vendas por produto", periodText: "01/11/2026 a 25/11/2026", emittedAt: "25/11/2026 14:00", emittedBy: "Rafael",
};

describe("PDF do relatório", () => {
  it("usa paisagem só em relatórios largos", () => {
    expect(isLandscape(5)).toBe(false);
    expect(isLandscape(7)).toBe(false);
    expect(isLandscape(8)).toBe(true);
  });

  it("gera várias páginas numeradas com acentos e totais", async () => {
    const header = ["Código", "Produto", "Quantidade", "Receita"];
    const rows = Array.from({ length: 120 }, (_, i) => [`P${i}`, `Açúcar refinado União ${i}`, String(i + 1), `R$ ${(i + 1) * 3},50`]);
    const doc = await buildReportPdf({ ...base, header, rows, totalRow: ["TOTAL", "", "7.260", "R$ 21.810,00"], rightAligned: [false, false, true, true], signature: true });
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expect(doc.internal.pageSize.getWidth()).toBeLessThan(doc.internal.pageSize.getHeight());
    const buf = Buffer.from(doc.output("arraybuffer"));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
  });

  it("gera paisagem com muitas colunas", async () => {
    const header = Array.from({ length: 10 }, (_, i) => `Col ${i}`);
    const doc = await buildReportPdf({ ...base, header, rows: [header.map((_, i) => String(i))], rightAligned: header.map(() => false) });
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  });
});
