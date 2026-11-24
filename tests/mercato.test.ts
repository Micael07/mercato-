import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  companies,
  establishments,
  users,
  companyUsers,
  companySettings,
  paymentMethods,
  suppliers,
  products,
  productStocks,
  productPriceHistory,
  stockMovements,
  purchaseOrders,
  purchaseOrderItems,
  cashRegisters,
  sales,
  salePayments,
  financialEntries,
  financialSettlements,
  auditLogs,
} from "@/db";
import { resolvePermissions } from "@/lib/permissions";
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth";
import { validatePasswordStrength, sha256Hex } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  completeSaleTx,
  cancelSaleTx,
  openCashRegisterTx,
  receivePurchaseOrderTx,
  settleFinancialEntryTx,
  reverseSettlementTx,
  DomainError,
} from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

describe("Mercato ERP - Segurança, Permissões e Fluxos Transacionais", () => {
  const testIds: {
    companyA?: string;
    companyB?: string;
    userId?: string;
  } = {};

  let estAId = "";
  let prodA1Id = "";
  let prodA2Id = "";
  let cashRegId = "";
  let supplierAId = "";

  beforeAll(async () => {
    const suffix = Date.now().toString().slice(-6);
    const [u] = await db
      .insert(users)
      .values({
        name: "Test Runner",
        email: `test-${suffix}@mercato.local`,
        passwordHash: hashPassword("Secret@123"),
      })
      .returning();
    testIds.userId = u.id;

    const [compA] = await db
      .insert(companies)
      .values({
        legalName: `Empresa Teste A ${suffix}`,
        tradeName: `Teste A ${suffix}`,
        cnpj: `11${suffix}000101`,
      })
      .returning();
    testIds.companyA = compA.id;

    const [compB] = await db
      .insert(companies)
      .values({
        legalName: `Empresa Teste B ${suffix}`,
        tradeName: `Teste B ${suffix}`,
        cnpj: `22${suffix}000102`,
      })
      .returning();
    testIds.companyB = compB.id;

    const [estA] = await db
      .insert(establishments)
      .values({
        companyId: compA.id,
        name: "Matriz A",
        code: "001",
        isDefault: true,
      })
      .returning();
    estAId = estA.id;

    await db.insert(companyUsers).values({
      companyId: compA.id,
      userId: u.id,
      defaultEstablishmentId: estA.id,
      roleCode: "admin",
      maxDiscountPercent: "100.00",
    });

    await db.insert(companySettings).values({
      companyId: compA.id,
      allowNegativeStock: false,
      maxDiscountPercent: "10.00",
      requireOpenCashRegister: true,
    });

    await db.insert(paymentMethods).values([
      { companyId: compA.id, name: "Dinheiro", code: "cash", sortOrder: 1 },
      { companyId: compA.id, name: "PIX", code: "pix", sortOrder: 2 },
    ]);

    const [sup] = await db
      .insert(suppliers)
      .values({
        companyId: compA.id,
        code: "FOR-T1",
        legalName: "Fornecedor Teste Ltda",
        tradeName: "Fornecedor Teste",
      })
      .returning();
    supplierAId = sup.id;

    const [p1, p2] = await db
      .insert(products)
      .values([
        {
          companyId: compA.id,
          internalCode: "T-001",
          sku: `SKU-T1-${suffix}`,
          barcode: `789${suffix}01`,
          name: "Produto Teste 1",
          costPrice: "10.0000",
          salePrice: "25.00",
          marginPercent: "150.00",
        },
        {
          companyId: compA.id,
          internalCode: "T-002",
          sku: `SKU-T2-${suffix}`,
          barcode: `789${suffix}02`,
          name: "Produto Teste 2",
          costPrice: "20.0000",
          salePrice: "50.00",
          marginPercent: "150.00",
        },
      ])
      .returning();
    prodA1Id = p1.id;
    prodA2Id = p2.id;

    await db.insert(productStocks).values([
      {
        companyId: compA.id,
        establishmentId: estA.id,
        productId: p1.id,
        quantity: "10.000",
      },
      {
        companyId: compA.id,
        establishmentId: estA.id,
        productId: p2.id,
        quantity: "2.000",
      },
    ]);
  });

  afterAll(async () => {
    if (testIds.companyA) {
      await db.delete(sales).where(eq(sales.companyId, testIds.companyA));
      await db
        .delete(purchaseOrders)
        .where(eq(purchaseOrders.companyId, testIds.companyA));
      await db
        .delete(cashRegisters)
        .where(eq(cashRegisters.companyId, testIds.companyA));
      await db.delete(companies).where(eq(companies.id, testIds.companyA));
    }
    if (testIds.companyB) {
      await db.delete(companies).where(eq(companies.id, testIds.companyB));
    }
    if (testIds.userId) {
      await db.delete(users).where(eq(users.id, testIds.userId));
    }
  });

  it("enforces RBAC permissions strictly by role", () => {
    const cashier = resolvePermissions("cashier");
    expect(cashier.has("sales.create")).toBe(true);
    expect(cashier.has("cash.open")).toBe(true);
    expect(cashier.has("products.view_cost")).toBe(false);
    expect(cashier.has("finance.read")).toBe(false);
    expect(cashier.has("sales.cancel")).toBe(false);
    expect(cashier.has("audit.read")).toBe(false);

    const stockist = resolvePermissions("stockist");
    expect(stockist.has("stock.move")).toBe(true);
    expect(stockist.has("stock.inventory")).toBe(true);
    expect(stockist.has("finance.read")).toBe(false);
    expect(stockist.has("cash.open")).toBe(false);
  });

  it("hashes passwords and rejects tampered HMAC session tokens", () => {
    const hash = hashPassword("Mercato@2026");
    expect(verifyPassword("Mercato@2026", hash)).toBe(true);
    expect(verifyPassword("WrongPass", hash)).toBe(false);

    const token = signSessionToken({
      userId: "u1",
      companyId: "c1",
      establishmentId: "e1",
    });
    expect(verifySessionToken(token)?.userId).toBe("u1");
    expect(verifySessionToken(token + "tamper")).toBeNull();
  });

  it("allows the same barcode in different companies but blocks duplicates in same company", async () => {
    const sharedBarcode = `789SHARED${Date.now().toString().slice(-4)}`;
    await db.insert(products).values({
      companyId: testIds.companyA!,
      internalCode: "BC-A",
      sku: `SKU-BCA-${Date.now()}`,
      barcode: sharedBarcode,
      name: "Item Empresa A",
      salePrice: "15.00",
    });

    const [insertedB] = await db
      .insert(products)
      .values({
        companyId: testIds.companyB!,
        internalCode: "BC-B",
        sku: `SKU-BCB-${Date.now()}`,
        barcode: sharedBarcode,
        name: "Item Empresa B",
        salePrice: "18.00",
      })
      .returning();
    expect(insertedB.barcode).toBe(sharedBarcode);

    await expect(
      db.insert(products).values({
        companyId: testIds.companyA!,
        internalCode: "BC-A2",
        sku: `SKU-BCA2-${Date.now()}`,
        barcode: sharedBarcode,
        name: "Duplicado Empresa A",
        salePrice: "15.00",
      })
    ).rejects.toThrow();
  });

  it("opens cash register, completes multi-payment sale, updates stock & cash, and logs audit", async () => {
    const reg = await openCashRegisterTx({
      companyId: testIds.companyA!,
      establishmentId: estAId,
      userId: testIds.userId!,
      userName: "Test Runner",
      terminalName: "Caixa Teste",
      openingAmount: 100,
    });
    cashRegId = reg.id;

    // Total = 2 * 25.00 = 50.00; Paid: 30 PIX + 50 Cash -> 30.00 change -> Net cash +20.00
    const sale = await completeSaleTx({
      companyId: testIds.companyA!,
      establishmentId: estAId,
      operatorId: testIds.userId!,
      operatorName: "Test Runner",
      operatorRole: "cashier",
      operatorMaxDiscountPercent: 5,
      cashRegisterId: cashRegId,
      items: [{ productId: prodA1Id, quantity: 2 }],
      payments: [
        { paymentMethodCode: "pix", paymentMethodName: "PIX", amount: 30 },
        { paymentMethodCode: "cash", paymentMethodName: "Dinheiro", amount: 50 },
      ],
    });

    expect(toNumber(sale.total)).toBe(50);
    expect(toNumber(sale.changeAmount)).toBe(30);

    const [stockRow] = await db
      .select()
      .from(productStocks)
      .where(
        and(
          eq(productStocks.establishmentId, estAId),
          eq(productStocks.productId, prodA1Id)
        )
      );
    expect(toNumber(stockRow.quantity)).toBe(8);

    const [regAfter] = await db
      .select()
      .from(cashRegisters)
      .where(eq(cashRegisters.id, cashRegId));
    expect(toNumber(regAfter.currentBalance)).toBe(120); // 100 + 20 net cash

    const pays = await db
      .select()
      .from(salePayments)
      .where(eq(salePayments.saleId, sale.id));
    expect(pays.length).toBe(2);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, sale.id));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("rolls back entire sale atomically when second item has insufficient stock", async () => {
    // prodA1 has 8, prodA2 has 2 -> requesting 5 of prodA2 must fail and keep prodA1 at 8!
    await expect(
      completeSaleTx({
        companyId: testIds.companyA!,
        establishmentId: estAId,
        operatorId: testIds.userId!,
        operatorName: "Test Runner",
        operatorRole: "admin",
        operatorMaxDiscountPercent: 100,
        cashRegisterId: cashRegId,
        items: [
          { productId: prodA1Id, quantity: 3 },
          { productId: prodA2Id, quantity: 5 },
        ],
        payments: [{ paymentMethodCode: "pix", amount: 325 }],
      })
    ).rejects.toThrow(DomainError);

    const [stockA1] = await db
      .select()
      .from(productStocks)
      .where(
        and(
          eq(productStocks.establishmentId, estAId),
          eq(productStocks.productId, prodA1Id)
        )
      );
    expect(toNumber(stockA1.quantity)).toBe(8);
  });

  it("blocks discount above operator limit", async () => {
    await expect(
      completeSaleTx({
        companyId: testIds.companyA!,
        establishmentId: estAId,
        operatorId: testIds.userId!,
        operatorName: "Test Runner",
        operatorRole: "cashier",
        operatorMaxDiscountPercent: 5,
        cashRegisterId: cashRegId,
        items: [{ productId: prodA1Id, quantity: 1 }],
        discountTotal: 10, // 40% discount > 5% limit
        payments: [{ paymentMethodCode: "pix", amount: 15 }],
      })
    ).rejects.toThrow(/excede o limite/);
  });

  it("restores stock on sale cancellation", async () => {
    const [existingSale] = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.companyId, testIds.companyA!),
          eq(sales.status, "completed")
        )
      )
      .limit(1);

    await cancelSaleTx({
      companyId: testIds.companyA!,
      establishmentId: estAId,
      saleId: existingSale.id,
      userId: testIds.userId!,
      userName: "Test Runner",
      reason: "Teste de estorno",
    });

    const [stockA1] = await db
      .select()
      .from(productStocks)
      .where(
        and(
          eq(productStocks.establishmentId, estAId),
          eq(productStocks.productId, prodA1Id)
        )
      );
    expect(toNumber(stockA1.quantity)).toBe(10);
  });

  it("receives purchase order partially and totally, updates stock, cost history, and generates payable", async () => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        companyId: testIds.companyA!,
        establishmentId: estAId,
        supplierId: supplierAId,
        orderNumber: 901,
        status: "approved",
        subtotal: "120.00",
        total: "120.00",
        createdBy: testIds.userId!,
      })
      .returning();

    const [poItem] = await db
      .insert(purchaseOrderItems)
      .values({
        purchaseOrderId: po.id,
        productId: prodA1Id,
        quantityOrdered: "10.000",
        quantityReceived: "0.000",
        unitCost: "12.0000",
        total: "120.00",
      })
      .returning();

    // Partial receipt (4 units)
    const afterPartial = await receivePurchaseOrderTx({
      companyId: testIds.companyA!,
      establishmentId: estAId,
      purchaseOrderId: po.id,
      invoiceNumber: "NF-PARTIAL",
      userId: testIds.userId!,
      userName: "Test Runner",
      items: [{ itemId: poItem.id, quantityReceiving: 4 }],
    });
    expect(afterPartial.status).toBe("partially_received");

    // Final receipt (6 units)
    const afterFull = await receivePurchaseOrderTx({
      companyId: testIds.companyA!,
      establishmentId: estAId,
      purchaseOrderId: po.id,
      invoiceNumber: "NF-FINAL",
      userId: testIds.userId!,
      userName: "Test Runner",
      items: [{ itemId: poItem.id, quantityReceiving: 6 }],
    });
    expect(afterFull.status).toBe("received");

    // Stock should now be 10 + 4 + 6 = 20
    const [stockA1] = await db
      .select()
      .from(productStocks)
      .where(
        and(
          eq(productStocks.establishmentId, estAId),
          eq(productStocks.productId, prodA1Id)
        )
      );
    expect(toNumber(stockA1.quantity)).toBe(20);

    // Price history recorded cost update 10 -> 12
    const priceHist = await db
      .select()
      .from(productPriceHistory)
      .where(eq(productPriceHistory.productId, prodA1Id));
    expect(priceHist.length).toBeGreaterThanOrEqual(1);

    // Payable generated and settle/reverse works
    const [payable] = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.originId, po.id),
          eq(financialEntries.type, "payable")
        )
      )
      .limit(1);
    expect(payable).toBeDefined();

    const settled = await settleFinancialEntryTx({
      companyId: testIds.companyA!,
      entryId: payable.id,
      amount: toNumber(payable.amount),
      paymentMethodCode: "pix",
      userId: testIds.userId!,
      userName: "Test Runner",
    });
    expect(settled.status).toBe("paid");

    const [settlementRow] = await db
      .select()
      .from(financialSettlements)
      .where(eq(financialSettlements.entryId, payable.id))
      .limit(1);

    const reversed = await reverseSettlementTx({
      companyId: testIds.companyA!,
      settlementId: settlementRow.id,
      userId: testIds.userId!,
      userName: "Test Runner",
      reason: "Teste estorno",
    });
    expect(reversed.status).toBe("open");
  });

  it("enforces password strength, hashes reset tokens, and enforces rate limiting", () => {
    expect(validatePasswordStrength("123456").valid).toBe(false);
    expect(validatePasswordStrength("abcdefgh").valid).toBe(false);
    expect(validatePasswordStrength("Mercato@2026").valid).toBe(true);

    const h1 = sha256Hex("raw-token-abc");
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe("raw-token-abc");

    const rlKey = `test-rl-${Date.now()}`;
    expect(checkRateLimit(rlKey, 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit(rlKey, 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit(rlKey, 2, 60_000).allowed).toBe(false);
  });
});
