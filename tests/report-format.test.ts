import { describe, expect, it } from "vitest";
import { columnLabel, computeTotals, formatCell, translateValue, visibleKeys } from "@/lib/report-format";

describe("formatação dos relatórios", () => {
  it("traduz nomes técnicos de colunas", () => {
    expect(columnLabel("grossProfit")).toBe("Lucro bruto");
    expect(columnLabel("saleNumber")).toBe("Nº da venda");
    expect(columnLabel("campoNovo")).toBe("Campo Novo");
  });

  it("formata moeda, percentual e data em pt-BR", () => {
    expect(formatCell("total", 1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatCell("marginPercent", 12.34)).toBe("12,3%");
    expect(formatCell("dueDate", "2026-12-02")).toBe("02/12/2026");
    expect(formatCell("total", null)).toBe("—");
  });

  it("data e hora usam o fuso da loja", () => {
    // 25/11 03:30 UTC = 24/11 23:30 em Manaus
    expect(formatCell("date", "2026-11-25T03:30:00Z", "America/Manaus")).toContain("24/11/2026");
  });

  it("traduz situações e tipos", () => {
    expect(translateValue("partially_received")).toBe("Recebido parcial");
    expect(translateValue("purchase_in")).toBe("Entrada por compra");
    expect(translateValue("Mercearia")).toBe("Mercearia");
  });

  it("soma só colunas somáveis", () => {
    const rows = [
      { total: 10.1, avgTicket: 5, quantity: 2, name: "A" },
      { total: 20.2, avgTicket: 7, quantity: 3, name: "B" },
    ];
    expect(computeTotals(["total", "avgTicket", "quantity", "name"], rows)).toEqual({ total: 30.3, quantity: 5 });
  });

  it("esconde chaves internas", () => {
    expect(visibleKeys([{ description: "x", amount: 1, _bold: true }])).toEqual(["description", "amount"]);
  });
});
