import { describe, expect, it } from "vitest";
import { calculatePosTotals, quantityIssue, restoredGlobalDiscount, type PosProduct } from "@/lib/pos";

const product: PosProduct = { id: "test-product", internalCode: "001", sku: "TEST", barcode: null, name: "Produto de teste", unit: "UN", salePrice: 34.9, currentStock: 10, allowFractional: false, trackStock: true, status: "active" };

describe("Cálculos e controles do PDV", () => {
  it("soma preço, quantidades, descontos por item, desconto geral e acréscimo", () => {
    const result = calculatePosTotals([
      { product, quantity: 1, discountAmount: 4 },
      { product: { ...product, id: "other", salePrice: 24.99 }, quantity: 1, discountAmount: 0 },
    ], 2, 1);
    expect(result.subtotal).toBe(59.89);
    expect(result.itemDiscounts).toBe(4);
    expect(result.discount).toBe(6);
    expect(result.total).toBe(54.89);
  });
  it("não esconde total inválido quando o desconto ultrapassa o subtotal", () => {
    expect(calculatePosTotals([{ product, quantity: 1, discountAmount: 0 }], 40).total).toBe(-5.1);
  });
  it("evita erro binário em preços e quantidades fracionadas", () => {
    expect(calculatePosTotals([{ product: { ...product, salePrice: .1 }, quantity: 3, discountAmount: 0 }]).total).toBe(.3);
  });
  it("bloqueia quantidade negativa, não finita ou fracionada indevida", () => {
    for (const value of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, .5]) expect(quantityIssue(product, value, false)).not.toBeNull();
    expect(quantityIssue({ ...product, allowFractional: true }, .125, false)).toBeNull();
  });
  it("respeita estoque e a configuração de estoque negativo", () => {
    expect(quantityIssue(product, 11, false)).toContain("Estoque disponível");
    expect(quantityIssue(product, 11, true)).toBeNull();
    expect(quantityIssue({ ...product, trackStock: false }, 11, false)).toBeNull();
  });
  it("retoma o desconto geral sem aplicar desconto de item duas vezes", () => {
    expect(restoredGlobalDiscount(5, [{ discountAmount: 2 }, { discountAmount: 1 }])).toBe(2);
    expect(restoredGlobalDiscount(0, [{ discountAmount: 1 }])).toBe(0);
  });
});
