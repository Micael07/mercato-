import { roundMoney } from "./format";

export interface PosProduct {
  id: string;
  internalCode: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  salePrice: number;
  currentStock: number;
  allowFractional: boolean;
  trackStock: boolean;
  status: string;
}
export interface PosCartLine { product: PosProduct; quantity: number; discountAmount: number }

export function calculatePosTotals(lines: PosCartLine[], globalDiscount = 0, surcharge = 0) {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + roundMoney(line.product.salePrice * line.quantity), 0));
  const itemDiscounts = roundMoney(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  return {
    subtotal,
    itemDiscounts,
    discount: roundMoney(itemDiscounts + globalDiscount),
    total: roundMoney(subtotal - itemDiscounts - globalDiscount + surcharge),
  };
}

export function quantityIssue(product: PosProduct, quantity: number, allowNegative: boolean): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Informe uma quantidade maior que zero.";
  if (!product.allowFractional && !Number.isInteger(quantity)) return "Este produto é vendido apenas em quantidades inteiras.";
  if (product.trackStock && !allowNegative && quantity > product.currentStock) return `Estoque disponível: ${product.currentStock} ${product.unit}.`;
  return null;
}

export function restoredGlobalDiscount(totalDiscount: number, items: Array<{ discountAmount: number }>) {
  return Math.max(0, roundMoney(totalDiscount - items.reduce((sum, line) => sum + line.discountAmount, 0)));
}

export function formatQuantity(quantity: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(quantity);
}
