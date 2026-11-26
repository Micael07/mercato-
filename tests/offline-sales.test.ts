import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, companies, establishments, users, companyUsers, companySettings, paymentMethods,
  products, productStocks, cashRegisters, sales, inventories, inventoryItems,
} from "@/db";
import { hashPassword } from "@/lib/auth";
import { completeSaleTx, openCashRegisterTx, approveInventoryTx, DomainError } from "@/lib/services/erp";
import { classifyResponse } from "@/lib/offline-sync";
import { toNumber } from "@/lib/format";

describe("Vendas offline e inventário", () => {
  let companyId = "", estId = "", userId = "", prodId = "", regId = "";
  const base = () => ({
    companyId, establishmentId: estId, operatorId: userId, operatorName: "Teste",
    operatorRole: "cashier", operatorMaxDiscountPercent: 5, cashRegisterId: regId,
  });

  beforeAll(async () => {
    const s = Date.now().toString().slice(-7);
    const [u] = await db.insert(users).values({ name: "Off", email: `off-${s}@mercato.local`, passwordHash: hashPassword("Secret@123") }).returning();
    userId = u.id;
    const [c] = await db.insert(companies).values({ legalName: `Off ${s}`, tradeName: `Off ${s}`, cnpj: `33${s}000103` }).returning();
    companyId = c.id;
    const [e] = await db.insert(establishments).values({ companyId, name: "Loja", code: "001", isDefault: true }).returning();
    estId = e.id;
    await db.insert(companyUsers).values({ companyId, userId, defaultEstablishmentId: estId, roleCode: "cashier", maxDiscountPercent: "5.00" });
    await db.insert(companySettings).values({ companyId, allowNegativeStock: false, maxDiscountPercent: "10.00", requireOpenCashRegister: true });
    await db.insert(paymentMethods).values([{ companyId, name: "Dinheiro", code: "cash", sortOrder: 1 }]);
    const [p] = await db.insert(products).values({ companyId, internalCode: "O-1", sku: `SKU-O-${s}`, name: "Item Off", costPrice: "5.0000", salePrice: "20.00", marginPercent: "300" }).returning();
    prodId = p.id;
    await db.insert(productStocks).values({ companyId, establishmentId: estId, productId: prodId, quantity: "1.000" });
    regId = (await openCashRegisterTx({ companyId, establishmentId: estId, userId, userName: "Teste", terminalName: "C1", openingAmount: 0 })).id;
  });

  afterAll(async () => {
    await db.delete(sales).where(eq(sales.companyId, companyId));
    await db.delete(cashRegisters).where(eq(cashRegisters.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("classifica respostas do servidor na sincronização", () => {
    expect(classifyResponse(201)).toBe("ok");
    expect(classifyResponse(200)).toBe("ok");
    expect(classifyResponse(401)).toBe("auth");
    expect(classifyResponse(409)).toBe("retry");
    expect(classifyResponse(500)).toBe("retry");
    expect(classifyResponse(400)).toBe("reject");
    expect(classifyResponse(403)).toBe("reject");
  });

  it("venda online sem estoque continua sendo recusada", async () => {
    await expect(
      completeSaleTx({ ...base(), items: [{ productId: prodId, quantity: 3 }], payments: [{ paymentMethodCode: "cash", amount: 60 }] })
    ).rejects.toThrow(DomainError);
  });

  it("venda offline usa o preço do balcão, a data real e aceita saldo negativo", async () => {
    const when = new Date(Date.now() - 3600_000);
    const sale = await completeSaleTx({
      ...base(), clientRef: "off_test_ref_0001", offline: { occurredAt: when },
      items: [{ productId: prodId, quantity: 3, unitPrice: 18 }],
      payments: [{ paymentMethodCode: "cash", amount: 54 }],
    });
    expect(toNumber(sale.total)).toBe(54);
    expect(sale.clientRef).toBe("off_test_ref_0001");
    expect(Math.abs(sale.createdAt.getTime() - when.getTime())).toBeLessThan(1000);
    expect(sale.notes).toContain("offline");
    const [stock] = await db.select().from(productStocks).where(and(eq(productStocks.productId, prodId), eq(productStocks.establishmentId, estId)));
    expect(toNumber(stock.quantity)).toBe(-2);
  });

  it("o mesmo identificador não grava duas vezes (índice único)", async () => {
    let code: string | undefined;
    try {
      await completeSaleTx({
        ...base(), clientRef: "off_test_ref_0001", offline: {},
        items: [{ productId: prodId, quantity: 1, unitPrice: 20 }],
        payments: [{ paymentMethodCode: "cash", amount: 20 }],
      });
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      code = err.code ?? err.cause?.code;
    }
    expect(code).toBe("23505");
    const rows = await db.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.clientRef, "off_test_ref_0001")));
    expect(rows).toHaveLength(1);
  });

  it("inventário: aprovar ignorando itens não contados não altera o saldo deles", async () => {
    const [inv] = await db.insert(inventories).values({ companyId, establishmentId: estId, code: "INV-T1", description: "t", status: "counting" }).returning();
    await db.insert(inventoryItems).values({ inventoryId: inv.id, productId: prodId, systemQuantity: "-2.000" });
    await expect(
      approveInventoryTx({ companyId, establishmentId: estId, inventoryId: inv.id, userId })
    ).rejects.toThrow(DomainError);
    const done = await approveInventoryTx({ companyId, establishmentId: estId, inventoryId: inv.id, userId, ignoreUncounted: true });
    expect(done.status).toBe("approved");
    const [stock] = await db.select().from(productStocks).where(and(eq(productStocks.productId, prodId), eq(productStocks.establishmentId, estId)));
    expect(toNumber(stock.quantity)).toBe(-2);
  });
});
