import { describe, it, expect } from "vitest";
import { classifyAbc, daysBetween, expiryStatus, suggestQuantity } from "../src/lib/reports-extra";

describe("relatórios extras", () => {
  it("classifica ABC pelo acumulado antes do item", () => {
    expect(classifyAbc(0)).toBe("A");
    expect(classifyAbc(79.9)).toBe("A");
    expect(classifyAbc(80)).toBe("B");
    expect(classifyAbc(94.9)).toBe("B");
    expect(classifyAbc(95)).toBe("C");
  });

  it("calcula dias entre datas e o status de validade", () => {
    expect(daysBetween("2026-11-25", "2026-12-05")).toBe(10);
    expect(daysBetween("2026-11-25", "2026-11-20")).toBe(-5);
    expect(expiryStatus(-1)).toBe("Vencido");
    expect(expiryStatus(0)).toBe("Vence em até 7 dias");
    expect(expiryStatus(20)).toBe("Vence em até 30 dias");
    expect(expiryStatus(45)).toBe("Vence em até 60 dias");
  });

  it("sugere compra só quando a cobertura está baixa", () => {
    // vende 10/dia, tem 100 (10 dias): acima do gatilho de 7 dias -> não sugere
    expect(suggestQuantity({ stock: 100, avgDaily: 10, minStock: 20, maxStock: 0, fractional: false })).toBe(0);
    // tem 50 (5 dias): repõe até 150 (15 dias)
    expect(suggestQuantity({ stock: 50, avgDaily: 10, minStock: 20, maxStock: 0, fractional: false })).toBe(100);
    // respeita o máximo cadastrado quando maior
    expect(suggestQuantity({ stock: 5, avgDaily: 1, minStock: 10, maxStock: 200, fractional: false })).toBe(195);
    // sem giro, abaixo do mínimo: repõe até o mínimo
    expect(suggestQuantity({ stock: 2, avgDaily: 0, minStock: 10, maxStock: 0, fractional: false })).toBe(8);
    // fracionado mantém casas decimais; inteiro arredonda para cima
    expect(suggestQuantity({ stock: 0.5, avgDaily: 0.3, minStock: 1, maxStock: 0, fractional: true })).toBe(4);
    expect(suggestQuantity({ stock: 0, avgDaily: 0.25, minStock: 0, maxStock: 0, fractional: false })).toBe(4);
  });
});
