import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  products,
  productStocks,
  productPriceHistory,
  stockMovements,
  inventories,
  inventoryItems,
  purchaseOrders,
  purchaseOrderItems,
  purchaseReceipts,
  cashRegisters,
  cashMovements,
  sales,
  saleItems,
  salePayments,
  customers,
  companySettings,
  financialEntries,
  financialSettlements,
  paymentMethods,
} from "@/db";
import { recordAudit } from "@/lib/audit";
import { roundMoney, toNumber } from "@/lib/format";
import { addDaysStr, todayInTz } from "@/lib/dates";

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================================================
// 1. STOCK MOVEMENT (TRANSACTIONAL)
// ============================================================================

export async function moveStockInTx(
  tx: DbTx,
  params: {
    companyId: string;
    establishmentId: string;
    productId: string;
    type:
      | "purchase_in"
      | "manual_in"
      | "sale_out"
      | "manual_out"
      | "return_in"
      | "adjustment_pos"
      | "adjustment_neg"
      | "transfer"
      | "inventory"
      | "loss_expired"
      | "loss_breakage"
      | "loss_theft";
    deltaQuantity: number; // positive adds stock, negative deducts stock
    unitCost?: number;
    originDocument?: string;
    originId?: string;
    userId: string;
    userName?: string;
    justification?: string;
    allowNegativeOverride?: boolean;
  }
) {
  const [product] = await tx
    .select()
    .from(products)
    .where(
      and(eq(products.id, params.productId), eq(products.companyId, params.companyId))
    )
    .limit(1);

  if (!product) {
    throw new DomainError("Produto não encontrado para esta empresa.", 404);
  }

  if (!product.trackStock) {
    return { previousBalance: 0, newBalance: 0 };
  }

  const [settings] = await tx
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, params.companyId))
    .limit(1);

  const allowNegative =
    params.allowNegativeOverride ?? settings?.allowNegativeStock ?? false;

  // Ensure row exists in product_stocks
  const existingRows = await tx
    .select()
    .from(productStocks)
    .where(
      and(
        eq(productStocks.establishmentId, params.establishmentId),
        eq(productStocks.productId, params.productId)
      )
    )
    .limit(1);

  let stockRow = existingRows[0];
  if (!stockRow) {
    const [inserted] = await tx
      .insert(productStocks)
      .values({
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        productId: params.productId,
        quantity: "0.000",
      })
      .returning();
    stockRow = inserted;
  }

  const previousBalance = toNumber(stockRow.quantity);
  const newBalance = Number((previousBalance + params.deltaQuantity).toFixed(3));

  if (!allowNegative && newBalance < 0) {
    throw new DomainError(
      `Estoque insuficiente para "${product.name}". Saldo atual: ${previousBalance} ${product.unit}.`,
      409
    );
  }

  await tx
    .update(productStocks)
    .set({
      quantity: newBalance.toFixed(3),
      updatedAt: new Date(),
    })
    .where(eq(productStocks.id, stockRow.id));

  await tx.insert(stockMovements).values({
    companyId: params.companyId,
    establishmentId: params.establishmentId,
    productId: params.productId,
    type: params.type,
    quantity: Math.abs(params.deltaQuantity).toFixed(3),
    previousBalance: previousBalance.toFixed(3),
    newBalance: newBalance.toFixed(3),
    unitCost: (params.unitCost ?? toNumber(product.costPrice)).toFixed(4),
    originDocument: params.originDocument ?? null,
    originId: params.originId ?? null,
    userId: params.userId,
    justification: params.justification ?? null,
  });

  return { previousBalance, newBalance };
}

export async function moveStockTx(params: {
  companyId: string;
  establishmentId: string;
  productId: string;
  type:
    | "purchase_in"
    | "manual_in"
    | "sale_out"
    | "manual_out"
    | "return_in"
    | "adjustment_pos"
    | "adjustment_neg"
    | "transfer"
    | "inventory"
    | "loss_expired"
    | "loss_breakage"
    | "loss_theft";
  quantity: number;
  unitCost?: number;
  originDocument?: string;
  originId?: string;
  userId: string;
  userName?: string;
  justification: string;
}) {
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    throw new DomainError("Quantidade da movimentação deve ser maior que zero.");
  }
  const isOut =
    params.type === "manual_out" ||
    params.type === "sale_out" ||
    params.type === "adjustment_neg" ||
    params.type.startsWith("loss_");
  const delta = isOut ? -params.quantity : params.quantity;

  return db.transaction(async (tx) => {
    const result = await moveStockInTx(tx, {
      ...params,
      deltaQuantity: delta,
    });
    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "stock_movement",
        entity: "product",
        entityId: params.productId,
        previousData: { balance: result.previousBalance },
        newData: {
          type: params.type,
          delta,
          balance: result.newBalance,
          justification: params.justification,
        },
      },
      tx as unknown as typeof db
    );
    return result;
  });
}

// ============================================================================
// 2. INVENTORY APPROVAL (TRANSACTIONAL)
// ============================================================================

export async function approveInventoryTx(params: {
  companyId: string;
  establishmentId: string;
  inventoryId: string;
  userId: string;
  userName?: string;
}) {
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(inventories)
      .where(
        and(
          eq(inventories.id, params.inventoryId),
          eq(inventories.companyId, params.companyId),
          eq(inventories.establishmentId, params.establishmentId)
        )
      )
      .limit(1);

    if (!inv) throw new DomainError("Inventário não encontrado.", 404);
    if (inv.status === "approved" || inv.status === "cancelled") {
      throw new DomainError("Este inventário já foi finalizado ou cancelado.", 409);
    }

    const items = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.inventoryId, inv.id));

    if (items.length === 0) {
      throw new DomainError("Inventário não possui itens para aprovação.");
    }

    for (const item of items) {
      const finalCount =
        item.recountQuantity !== null
          ? toNumber(item.recountQuantity)
          : item.countedQuantity !== null
          ? toNumber(item.countedQuantity)
          : null;

      if (finalCount === null) {
        throw new DomainError(
          "Todos os itens do inventário precisam ser contados antes da aprovação."
        );
      }

      const sysQty = toNumber(item.systemQuantity);
      const divergence = Number((finalCount - sysQty).toFixed(3));

      await tx
        .update(inventoryItems)
        .set({
          divergence: divergence.toFixed(3),
          adjusted: divergence !== 0,
        })
        .where(eq(inventoryItems.id, item.id));

      if (divergence !== 0) {
        await moveStockInTx(tx, {
          companyId: params.companyId,
          establishmentId: params.establishmentId,
          productId: item.productId,
          type: "inventory",
          deltaQuantity: divergence,
          originDocument: inv.code,
          originId: inv.id,
          userId: params.userId,
          userName: params.userName,
          justification: `Ajuste de inventário ${inv.code} (Sistema: ${sysQty}, Contado: ${finalCount})`,
          allowNegativeOverride: false,
        });
      }
    }

    const [updated] = await tx
      .update(inventories)
      .set({
        status: "approved",
        closedBy: params.userId,
        closedAt: new Date(),
      })
      .where(eq(inventories.id, inv.id))
      .returning();

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "inventory_approved",
        entity: "inventory",
        entityId: inv.id,
        previousData: { status: inv.status },
        newData: { status: "approved", itemsCount: items.length },
      },
      tx as unknown as typeof db
    );

    return updated;
  });
}

// ============================================================================
// 3. CASH REGISTER OPEN / CLOSE / MOVE (TRANSACTIONAL)
// ============================================================================

export async function openCashRegisterTx(params: {
  companyId: string;
  establishmentId: string;
  userId: string;
  userName?: string;
  terminalName?: string;
  openingAmount: number;
}) {
  if (params.openingAmount < 0) {
    throw new DomainError("Valor inicial do caixa não pode ser negativo.");
  }

  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, params.companyId))
      .limit(1);

    if (settings?.singleOpenCashPerOperator ?? true) {
      const existing = await tx
        .select()
        .from(cashRegisters)
        .where(
          and(
            eq(cashRegisters.companyId, params.companyId),
            eq(cashRegisters.establishmentId, params.establishmentId),
            eq(cashRegisters.userId, params.userId),
            eq(cashRegisters.status, "open")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new DomainError(
          "Você já possui um caixa aberto neste estabelecimento.",
          409
        );
      }
    }

    const [register] = await tx
      .insert(cashRegisters)
      .values({
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        userId: params.userId,
        terminalName: params.terminalName?.trim() || "Caixa 01",
        status: "open",
        openingAmount: params.openingAmount.toFixed(2),
        currentBalance: params.openingAmount.toFixed(2),
      })
      .returning();

    await tx.insert(cashMovements).values({
      companyId: params.companyId,
      establishmentId: params.establishmentId,
      cashRegisterId: register.id,
      type: "opening",
      paymentMethodCode: "cash",
      amount: params.openingAmount.toFixed(2),
      description: `Abertura de caixa (${register.terminalName})`,
      userId: params.userId,
    });

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "cash_open",
        entity: "cash_register",
        entityId: register.id,
        newData: {
          terminalName: register.terminalName,
          openingAmount: params.openingAmount,
        },
      },
      tx as unknown as typeof db
    );

    return register;
  });
}

export async function closeCashRegisterTx(params: {
  companyId: string;
  establishmentId: string;
  cashRegisterId: string;
  userId: string;
  userName?: string;
  countedClosingAmount: number;
  differenceJustification?: string;
  closingNotes?: string;
}) {
  return db.transaction(async (tx) => {
    const [register] = await tx
      .select()
      .from(cashRegisters)
      .where(
        and(
          eq(cashRegisters.id, params.cashRegisterId),
          eq(cashRegisters.companyId, params.companyId),
          eq(cashRegisters.establishmentId, params.establishmentId)
        )
      )
      .limit(1);

    if (!register) throw new DomainError("Caixa não encontrado.", 404);
    if (register.status !== "open") {
      throw new DomainError("Este caixa já está fechado.", 409);
    }

    const expected = toNumber(register.currentBalance);
    const counted = roundMoney(params.countedClosingAmount);
    const difference = roundMoney(counted - expected);

    if (
      Math.abs(difference) >= 0.01 &&
      (!params.differenceJustification || params.differenceJustification.trim().length < 3)
    ) {
      throw new DomainError(
        "Há diferença no fechamento de caixa. Informe uma justificativa."
      );
    }

    const [updated] = await tx
      .update(cashRegisters)
      .set({
        status: "closed",
        expectedClosingAmount: expected.toFixed(2),
        countedClosingAmount: counted.toFixed(2),
        differenceAmount: difference.toFixed(2),
        differenceJustification: params.differenceJustification ?? null,
        closingNotes: params.closingNotes ?? null,
        closedAt: new Date(),
      })
      .where(eq(cashRegisters.id, register.id))
      .returning();

    await tx.insert(cashMovements).values({
      companyId: params.companyId,
      establishmentId: params.establishmentId,
      cashRegisterId: register.id,
      type: "closing",
      paymentMethodCode: "cash",
      amount: counted.toFixed(2),
      description: `Fechamento de caixa (Esperado: ${expected.toFixed(2)}, Contado: ${counted.toFixed(2)})`,
      userId: params.userId,
    });

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: params.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "cash_close",
        entity: "cash_register",
        entityId: register.id,
        previousData: { status: "open", expected },
        newData: { status: "closed", counted, difference },
      },
      tx as unknown as typeof db
    );

    return updated;
  });
}

// ============================================================================
// 4. COMPLETE SALE IN PDV (SINGLE ATOMIC TRANSACTION)
// ============================================================================

export interface CompleteSaleInput {
  companyId: string;
  establishmentId: string;
  operatorId: string;
  operatorName: string;
  operatorRole: string;
  operatorMaxDiscountPercent: number;
  customerId?: string | null;
  cashRegisterId?: string | null;
  items: Array<{
    productId: string;
    quantity: number;
    discountAmount?: number;
  }>;
  payments: Array<{
    paymentMethodId?: string | null;
    paymentMethodCode: string;
    paymentMethodName?: string;
    amount: number;
    installments?: number;
    reference?: string;
  }>;
  discountTotal?: number;
  surchargeTotal?: number;
  notes?: string;
  status?: "completed" | "suspended";
  suspendedSaleId?: string | null;
}

export async function completeSaleTx(input: CompleteSaleInput) {
  if (!input.items || input.items.length === 0) {
    throw new DomainError("Adicione ao menos um item à venda.");
  }

  const isSuspended = input.status === "suspended";

  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, input.companyId))
      .limit(1);

    const requireCash = settings?.requireOpenCashRegister ?? true;

    let cashReg: typeof cashRegisters.$inferSelect | undefined;
    if (!isSuspended) {
      if (input.cashRegisterId) {
        const [found] = await tx
          .select()
          .from(cashRegisters)
          .where(
            and(
              eq(cashRegisters.id, input.cashRegisterId),
              eq(cashRegisters.companyId, input.companyId),
              eq(cashRegisters.establishmentId, input.establishmentId),
              eq(cashRegisters.status, "open")
            )
          )
          .limit(1);
        cashReg = found;
      } else {
        const [found] = await tx
          .select()
          .from(cashRegisters)
          .where(
            and(
              eq(cashRegisters.companyId, input.companyId),
              eq(cashRegisters.establishmentId, input.establishmentId),
              eq(cashRegisters.userId, input.operatorId),
              eq(cashRegisters.status, "open")
            )
          )
          .limit(1);
        cashReg = found;
      }

      if (requireCash && !cashReg) {
        throw new DomainError(
          "Não há caixa aberto para finalizar a venda. Abra o caixa primeiro.",
          409
        );
      }
    }

    // Load products
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const prodRows = await tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.companyId, input.companyId),
          inArray(products.id, productIds)
        )
      );
    const prodMap = new Map(prodRows.map((p) => [p.id, p]));

    let subtotal = 0;
    let itemDiscountSum = 0;
    const preparedItems: Array<{
      product: typeof products.$inferSelect;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
      total: number;
    }> = [];

    for (const item of input.items) {
      const prod = prodMap.get(item.productId);
      if (!prod || prod.status !== "active") {
        throw new DomainError("Produto inválido ou inativo no carrinho.");
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new DomainError(`Quantidade inválida para "${prod.name}".`);
      }
      if (!prod.allowFractional && !Number.isInteger(item.quantity)) {
        throw new DomainError(
          `Produto "${prod.name}" não permite venda fracionada.`
        );
      }
      const unitPrice = toNumber(prod.salePrice);
      const lineGross = roundMoney(unitPrice * item.quantity);
      const disc = roundMoney(item.discountAmount ?? 0);
      if (disc < 0 || disc > lineGross) {
        throw new DomainError(`Desconto inválido no item "${prod.name}".`);
      }
      const lineTotal = roundMoney(lineGross - disc);
      subtotal = roundMoney(subtotal + lineGross);
      itemDiscountSum = roundMoney(itemDiscountSum + disc);

      preparedItems.push({
        product: prod,
        quantity: item.quantity,
        unitPrice,
        discountAmount: disc,
        total: lineTotal,
      });
    }

    const globalDiscount = roundMoney(input.discountTotal ?? 0);
    const surchargeTotal = roundMoney(input.surchargeTotal ?? 0);
    const totalDiscount = roundMoney(itemDiscountSum + globalDiscount);
    const total = roundMoney(subtotal - totalDiscount + surchargeTotal);

    if (total < 0) {
      throw new DomainError("Total da venda não pode ser negativo.");
    }

    // Discount validation
    if (subtotal > 0 && totalDiscount > 0) {
      const discountPct = (totalDiscount / subtotal) * 100;
      const roleLimit =
        input.operatorRole === "admin"
          ? 100
          : input.operatorRole === "manager"
          ? Math.max(
              toNumber(settings?.managerMaxDiscountPercent ?? 25),
              input.operatorMaxDiscountPercent
            )
          : Math.min(
              toNumber(settings?.maxDiscountPercent ?? 10),
              input.operatorMaxDiscountPercent
            );

      if (discountPct > roleLimit + 0.01) {
        throw new DomainError(
          `Desconto de ${discountPct.toFixed(1)}% excede o limite permitido (${roleLimit.toFixed(1)}%).`,
          403
        );
      }
    }

    let changeAmount = 0;
    const resolvedPayments: Array<{
      paymentMethodId: string | null;
      paymentMethodCode: string;
      paymentMethodName: string;
      amount: number;
      installments: number;
      reference: string | null;
    }> = [];

    if (!isSuspended) {
      if (!input.payments || input.payments.length === 0) {
        throw new DomainError("Informe ao menos uma forma de pagamento.");
      }

      const companyPms = await tx
        .select()
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.companyId, input.companyId),
            eq(paymentMethods.isActive, true)
          )
        );
      const pmByCode = new Map(companyPms.map((p) => [p.code, p]));
      const pmById = new Map(companyPms.map((p) => [p.id, p]));

      let paidSum = 0;
      let cashPaid = 0;

      for (const p of input.payments) {
        if (!Number.isFinite(p.amount) || p.amount <= 0) {
          throw new DomainError("Valor de pagamento deve ser maior que zero.");
        }
        const pmRow =
          (p.paymentMethodId ? pmById.get(p.paymentMethodId) : undefined) ??
          pmByCode.get(p.paymentMethodCode);

        const code = pmRow?.code ?? p.paymentMethodCode;
        const name =
          pmRow?.name ?? p.paymentMethodName ?? code.toUpperCase();

        if (code === "store_credit") {
          if (!input.customerId) {
            throw new DomainError(
              "Selecione um cliente para pagamento em crediário."
            );
          }
          const [cust] = await tx
            .select()
            .from(customers)
            .where(
              and(
                eq(customers.id, input.customerId),
                eq(customers.companyId, input.companyId)
              )
            )
            .limit(1);
          if (!cust) throw new DomainError("Cliente não encontrado.");
          const limit = toNumber(cust.creditLimit);
          const openBal = toNumber(cust.openBalance);
          if (limit > 0 && openBal + p.amount > limit) {
            throw new DomainError(
              `Limite de crédito do cliente excedido. Disponível: R$ ${(limit - openBal).toFixed(2)}`
            );
          }
        }

        paidSum = roundMoney(paidSum + p.amount);
        if (code === "cash") {
          cashPaid = roundMoney(cashPaid + p.amount);
        }

        resolvedPayments.push({
          paymentMethodId: pmRow?.id ?? null,
          paymentMethodCode: code,
          paymentMethodName: name,
          amount: roundMoney(p.amount),
          installments: p.installments ?? 1,
          reference: p.reference ?? null,
        });
      }

      if (paidSum + 0.009 < total) {
        throw new DomainError(
          `Valor pago (R$ ${paidSum.toFixed(2)}) é menor que o total da venda (R$ ${total.toFixed(2)}).`
        );
      }

      const excess = roundMoney(paidSum - total);
      if (excess > 0) {
        if (excess > cashPaid + 0.01) {
          throw new DomainError(
            "Troco só pode ser gerado sobre o valor pago em dinheiro."
          );
        }
        changeAmount = excess;
      }
    }

    // If resuming a suspended sale, delete old suspended shell or reuse number
    let saleNumber: number;
    if (input.suspendedSaleId) {
      const [oldSuspended] = await tx
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.id, input.suspendedSaleId),
            eq(sales.companyId, input.companyId),
            eq(sales.status, "suspended")
          )
        )
        .limit(1);
      if (oldSuspended) {
        saleNumber = oldSuspended.saleNumber;
        await tx.delete(sales).where(eq(sales.id, oldSuspended.id));
      } else {
        const [updatedSettings] = await tx
          .update(companySettings)
          .set({ nextSaleNumber: sql`${companySettings.nextSaleNumber} + 1` })
          .where(eq(companySettings.companyId, input.companyId))
          .returning();
        saleNumber = (updatedSettings?.nextSaleNumber ?? 1002) - 1;
      }
    } else {
      const [updatedSettings] = await tx
        .update(companySettings)
        .set({ nextSaleNumber: sql`${companySettings.nextSaleNumber} + 1` })
        .where(eq(companySettings.companyId, input.companyId))
        .returning();
      saleNumber = (updatedSettings?.nextSaleNumber ?? 1002) - 1;
    }

    const [createdSale] = await tx
      .insert(sales)
      .values({
        companyId: input.companyId,
        establishmentId: input.establishmentId,
        saleNumber,
        cashRegisterId: cashReg?.id ?? null,
        customerId: input.customerId ?? null,
        operatorId: input.operatorId,
        status: isSuspended ? "suspended" : "completed",
        subtotal: subtotal.toFixed(2),
        discountTotal: totalDiscount.toFixed(2),
        surchargeTotal: surchargeTotal.toFixed(2),
        total: total.toFixed(2),
        changeAmount: changeAmount.toFixed(2),
        notes: input.notes ?? null,
      })
      .returning();

    for (const item of preparedItems) {
      await tx.insert(saleItems).values({
        saleId: createdSale.id,
        productId: item.product.id,
        productName: item.product.name,
        sku: item.product.sku,
        quantity: item.quantity.toFixed(3),
        unitPrice: item.unitPrice.toFixed(2),
        costPriceSnapshot: toNumber(item.product.costPrice).toFixed(4),
        discountAmount: item.discountAmount.toFixed(2),
        total: item.total.toFixed(2),
      });

      if (!isSuspended) {
        await moveStockInTx(tx, {
          companyId: input.companyId,
          establishmentId: input.establishmentId,
          productId: item.product.id,
          type: "sale_out",
          deltaQuantity: -item.quantity,
          unitCost: toNumber(item.product.costPrice),
          originDocument: `VENDA #${saleNumber}`,
          originId: createdSale.id,
          userId: input.operatorId,
          userName: input.operatorName,
          justification: `Saída por venda PDV #${saleNumber}`,
        });
      }
    }

    if (!isSuspended) {
      let netCashIncrease = 0;
      for (const pay of resolvedPayments) {
        await tx.insert(salePayments).values({
          saleId: createdSale.id,
          paymentMethodId: pay.paymentMethodId,
          paymentMethodName: pay.paymentMethodName,
          paymentMethodCode: pay.paymentMethodCode,
          amount: pay.amount.toFixed(2),
          installments: pay.installments,
          reference: pay.reference,
        });

        if (pay.paymentMethodCode === "cash") {
          const netCash = roundMoney(pay.amount - changeAmount);
          // change subtracted once
          if (netCashIncrease === 0) {
            netCashIncrease = roundMoney(netCashIncrease + netCash);
          } else {
            netCashIncrease = roundMoney(netCashIncrease + pay.amount);
          }
        }

        if (pay.paymentMethodCode === "store_credit" && input.customerId) {
          await tx
            .update(customers)
            .set({
              openBalance: sql`${customers.openBalance} + ${pay.amount.toFixed(2)}::numeric`,
              updatedAt: new Date(),
            })
            .where(eq(customers.id, input.customerId));

          const todayStr = todayInTz();
          const due = new Date(Date.now() + 30 * 86400 * 1000)
            .toISOString()
            .slice(0, 10);

          await tx.insert(financialEntries).values({
            companyId: input.companyId,
            establishmentId: input.establishmentId,
            type: "receivable",
            originType: "sale",
            originId: createdSale.id,
            customerId: input.customerId,
            description: `Crediário Venda #${saleNumber}`,
            competenceDate: todayStr,
            issueDate: todayStr,
            dueDate: due,
            amount: pay.amount.toFixed(2),
            paidAmount: "0.00",
            status: "open",
            paymentMethodCode: "store_credit",
            createdBy: input.operatorId,
          });
        }
      }

      if (cashReg) {
        // Record cash register movements (drawer cash balance changes on physical cash; record non-cash sales as informational 0 drawer impact or separate movement)
        if (netCashIncrease > 0) {
          await tx
            .update(cashRegisters)
            .set({
              currentBalance: sql`${cashRegisters.currentBalance} + ${netCashIncrease.toFixed(2)}::numeric`,
            })
            .where(eq(cashRegisters.id, cashReg.id));

          await tx.insert(cashMovements).values({
            companyId: input.companyId,
            establishmentId: input.establishmentId,
            cashRegisterId: cashReg.id,
            type: "sale_in",
            paymentMethodCode: "cash",
            amount: netCashIncrease.toFixed(2),
            description: `Venda #${saleNumber} (Dinheiro líquido)`,
            originId: createdSale.id,
            userId: input.operatorId,
          });
        }
        for (const pay of resolvedPayments.filter(
          (p) => p.paymentMethodCode !== "cash"
        )) {
          await tx.insert(cashMovements).values({
            companyId: input.companyId,
            establishmentId: input.establishmentId,
            cashRegisterId: cashReg.id,
            type: "sale_in",
            paymentMethodCode: pay.paymentMethodCode,
            amount: pay.amount.toFixed(2),
            description: `Venda #${saleNumber} (${pay.paymentMethodName})`,
            originId: createdSale.id,
            userId: input.operatorId,
          });
        }
      }
    }

    await recordAudit(
      {
        companyId: input.companyId,
        establishmentId: input.establishmentId,
        userId: input.operatorId,
        userName: input.operatorName,
        action: isSuspended ? "sale_suspended" : "sale_completed",
        entity: "sale",
        entityId: createdSale.id,
        newData: {
          saleNumber,
          total,
          discount: totalDiscount,
          itemsCount: preparedItems.length,
        },
      },
      tx as unknown as typeof db
    );

    return createdSale;
  });
}

// ============================================================================
// 5. CANCEL SALE (TRANSACTIONAL)
// ============================================================================

export async function cancelSaleTx(params: {
  companyId: string;
  establishmentId: string;
  saleId: string;
  userId: string;
  userName: string;
  reason: string;
}) {
  if (!params.reason || params.reason.trim().length < 3) {
    throw new DomainError("Informe o motivo do cancelamento.");
  }

  return db.transaction(async (tx) => {
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, params.saleId), eq(sales.companyId, params.companyId)))
      .limit(1);

    if (!sale) throw new DomainError("Venda não encontrada.", 404);
    if (sale.status === "cancelled") {
      throw new DomainError("Esta venda já está cancelada.", 409);
    }

    const items = await tx
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id));

    if (sale.status !== "suspended") {
      for (const item of items) {
        const remainingToReturn =
          toNumber(item.quantity) - toNumber(item.returnedQuantity);
        if (remainingToReturn > 0) {
          await moveStockInTx(tx, {
            companyId: params.companyId,
            establishmentId: sale.establishmentId,
            productId: item.productId,
            type: "return_in",
            deltaQuantity: remainingToReturn,
            unitCost: toNumber(item.costPriceSnapshot),
            originDocument: `CANCEL VENDA #${sale.saleNumber}`,
            originId: sale.id,
            userId: params.userId,
            userName: params.userName,
            justification: `Estorno por cancelamento da venda #${sale.saleNumber}: ${params.reason}`,
          });
        }
      }

      // Refund cash movement if paid in cash and cash register is still open
      const payments = await tx
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, sale.id));

      const cashTotal = roundMoney(
        payments
          .filter((p) => p.paymentMethodCode === "cash")
          .reduce((acc, p) => acc + toNumber(p.amount), 0) -
          toNumber(sale.changeAmount)
      );

      if (cashTotal > 0 && sale.cashRegisterId) {
        const [reg] = await tx
          .select()
          .from(cashRegisters)
          .where(eq(cashRegisters.id, sale.cashRegisterId))
          .limit(1);
        if (reg && reg.status === "open") {
          await tx
            .update(cashRegisters)
            .set({
              currentBalance: sql`${cashRegisters.currentBalance} - ${cashTotal.toFixed(2)}::numeric`,
            })
            .where(eq(cashRegisters.id, reg.id));

          await tx.insert(cashMovements).values({
            companyId: params.companyId,
            establishmentId: sale.establishmentId,
            cashRegisterId: reg.id,
            type: "refund_out",
            paymentMethodCode: "cash",
            amount: cashTotal.toFixed(2),
            description: `Estorno venda cancelada #${sale.saleNumber}`,
            originId: sale.id,
            userId: params.userId,
          });
        }
      }

      // Cancel open receivable entries from this sale
      await tx
        .update(financialEntries)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(financialEntries.companyId, params.companyId),
            eq(financialEntries.originType, "sale"),
            eq(financialEntries.originId, sale.id),
            eq(financialEntries.status, "open")
          )
        );
    }

    const [updated] = await tx
      .update(sales)
      .set({
        status: "cancelled",
        cancelledBy: params.userId,
        cancelReason: params.reason,
        cancelledAt: new Date(),
      })
      .where(eq(sales.id, sale.id))
      .returning();

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: sale.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "sale_cancelled",
        entity: "sale",
        entityId: sale.id,
        previousData: { status: sale.status, total: sale.total },
        newData: { status: "cancelled", reason: params.reason },
      },
      tx as unknown as typeof db
    );

    return updated;
  });
}

// ============================================================================
// 6. RECEIVE PURCHASE ORDER (TRANSACTIONAL)
// ============================================================================

export async function receivePurchaseOrderTx(params: {
  companyId: string;
  establishmentId: string;
  purchaseOrderId: string;
  invoiceNumber?: string;
  notes?: string;
  userId: string;
  userName: string;
  generatePayable?: boolean;
  dueDate?: string;
  items: Array<{
    itemId: string;
    quantityReceiving: number;
  }>;
}) {
  return db.transaction(async (tx) => {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, params.purchaseOrderId),
          eq(purchaseOrders.companyId, params.companyId)
        )
      )
      .limit(1);

    if (!po) throw new DomainError("Pedido de compra não encontrado.", 404);
    if (po.status === "cancelled" || po.status === "received") {
      throw new DomainError(
        "Pedido já recebido integralmente ou cancelado.",
        409
      );
    }

    const poItems = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, po.id));
    const itemMap = new Map(poItems.map((i) => [i.id, i]));

    let receivedValue = 0;
    let totalReceivedCount = 0;

    for (const reqItem of params.items) {
      if (reqItem.quantityReceiving <= 0) continue;
      const poItem = itemMap.get(reqItem.itemId);
      if (!poItem) throw new DomainError("Item do pedido não encontrado.");

      const ordered = toNumber(poItem.quantityOrdered);
      const already = toNumber(poItem.quantityReceived);
      const remaining = Number((ordered - already).toFixed(3));

      if (reqItem.quantityReceiving > remaining + 0.001) {
        throw new DomainError(
          `Quantidade recebida (${reqItem.quantityReceiving}) excede o saldo pendente (${remaining}).`
        );
      }

      const newReceived = Number((already + reqItem.quantityReceiving).toFixed(3));
      await tx
        .update(purchaseOrderItems)
        .set({ quantityReceived: newReceived.toFixed(3) })
        .where(eq(purchaseOrderItems.id, poItem.id));

      const unitCost = toNumber(poItem.unitCost);
      receivedValue = roundMoney(receivedValue + unitCost * reqItem.quantityReceiving);
      totalReceivedCount++;

      await moveStockInTx(tx, {
        companyId: params.companyId,
        establishmentId: po.establishmentId,
        productId: poItem.productId,
        type: "purchase_in",
        deltaQuantity: reqItem.quantityReceiving,
        unitCost,
        originDocument: params.invoiceNumber
          ? `PC #${po.orderNumber} / NF ${params.invoiceNumber}`
          : `PC #${po.orderNumber}`,
        originId: po.id,
        userId: params.userId,
        userName: params.userName,
        justification: `Recebimento de compra #${po.orderNumber}`,
      });

      // Update product cost if changed
      const [prod] = await tx
        .select()
        .from(products)
        .where(eq(products.id, poItem.productId))
        .limit(1);
      if (prod && Math.abs(toNumber(prod.costPrice) - unitCost) > 0.0001) {
        const salePrice = toNumber(prod.salePrice);
        const margin =
          unitCost > 0 ? ((salePrice - unitCost) / unitCost) * 100 : 0;
        await tx
          .update(products)
          .set({
            costPrice: unitCost.toFixed(4),
            marginPercent: margin.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(products.id, prod.id));

        await tx.insert(productPriceHistory).values({
          companyId: params.companyId,
          productId: prod.id,
          previousCost: prod.costPrice,
          newCost: unitCost.toFixed(4),
          previousPrice: prod.salePrice,
          newPrice: prod.salePrice,
          changedBy: params.userId,
          reason: `Atualização de custo via recebimento PC #${po.orderNumber}`,
        });
      }
    }

    if (totalReceivedCount === 0) {
      throw new DomainError("Informe ao menos uma quantidade maior que zero para recebimento.");
    }

    // Recompute overall PO status
    const refreshedItems = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, po.id));

    const allReceived = refreshedItems.every(
      (i) => toNumber(i.quantityReceived) + 0.001 >= toNumber(i.quantityOrdered)
    );
    const newStatus = allReceived ? "received" : "partially_received";

    const [updatedPo] = await tx
      .update(purchaseOrders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, po.id))
      .returning();

    await tx.insert(purchaseReceipts).values({
      companyId: params.companyId,
      establishmentId: po.establishmentId,
      purchaseOrderId: po.id,
      invoiceNumber: params.invoiceNumber ?? null,
      receivedBy: params.userId,
      notes: params.notes ?? null,
    });

    if (params.generatePayable !== false && receivedValue > 0) {
      const todayStr = todayInTz();
      const dueStr =
        params.dueDate ?? addDaysStr(todayStr, 30);

      await tx.insert(financialEntries).values({
        companyId: params.companyId,
        establishmentId: po.establishmentId,
        type: "payable",
        originType: "purchase",
        originId: po.id,
        supplierId: po.supplierId,
        description: `Compra #${po.orderNumber}${params.invoiceNumber ? ` (NF ${params.invoiceNumber})` : ""}`,
        competenceDate: todayStr,
        issueDate: todayStr,
        dueDate: dueStr,
        amount: receivedValue.toFixed(2),
        paidAmount: "0.00",
        status: "open",
        createdBy: params.userId,
      });
    }

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: po.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "purchase_received",
        entity: "purchase_order",
        entityId: po.id,
        previousData: { status: po.status },
        newData: {
          status: newStatus,
          receivedValue,
          invoiceNumber: params.invoiceNumber,
        },
      },
      tx as unknown as typeof db
    );

    return updatedPo;
  });
}

// ============================================================================
// 7. FINANCIAL SETTLEMENT & REVERSAL (TRANSACTIONAL)
// ============================================================================

export async function settleFinancialEntryTx(params: {
  companyId: string;
  entryId: string;
  amount: number;
  interest?: number;
  penalty?: number;
  discount?: number;
  paymentMethodCode: string;
  userId: string;
  userName: string;
  notes?: string;
}) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new DomainError("Valor da baixa deve ser maior que zero.");
  }

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.id, params.entryId),
          eq(financialEntries.companyId, params.companyId)
        )
      )
      .limit(1);

    if (!entry) throw new DomainError("Título financeiro não encontrado.", 404);
    if (entry.status === "paid" || entry.status === "cancelled") {
      throw new DomainError("Título já está quitado ou cancelado.", 409);
    }

    const totalBase = toNumber(entry.amount);
    const prevPaid = toNumber(entry.paidAmount);
    const interest = roundMoney(params.interest ?? 0);
    const penalty = roundMoney(params.penalty ?? 0);
    const discount = roundMoney(params.discount ?? 0);

    const effectivePaid = roundMoney(prevPaid + params.amount);
    const netTarget = roundMoney(totalBase + interest + penalty - discount);

    const newStatus = effectivePaid + 0.01 >= netTarget ? "paid" : "partial";

    await tx.insert(financialSettlements).values({
      companyId: params.companyId,
      entryId: entry.id,
      amount: params.amount.toFixed(2),
      interest: interest.toFixed(2),
      penalty: penalty.toFixed(2),
      discount: discount.toFixed(2),
      paymentMethodCode: params.paymentMethodCode,
      settledBy: params.userId,
      notes: params.notes ?? null,
    });

    const [updated] = await tx
      .update(financialEntries)
      .set({
        paidAmount: effectivePaid.toFixed(2),
        interest: (toNumber(entry.interest) + interest).toFixed(2),
        penalty: (toNumber(entry.penalty) + penalty).toFixed(2),
        discount: (toNumber(entry.discount) + discount).toFixed(2),
        status: newStatus,
        paymentMethodCode: params.paymentMethodCode,
        updatedAt: new Date(),
      })
      .where(eq(financialEntries.id, entry.id))
      .returning();

    if (entry.type === "receivable" && entry.customerId) {
      await tx
        .update(customers)
        .set({
          openBalance: sql`GREATEST(0, ${customers.openBalance} - ${params.amount.toFixed(2)}::numeric)`,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, entry.customerId));
    }

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: entry.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "financial_settlement",
        entity: "financial_entry",
        entityId: entry.id,
        previousData: { status: entry.status, paidAmount: entry.paidAmount },
        newData: { status: newStatus, settledAmount: params.amount },
      },
      tx as unknown as typeof db
    );

    return updated;
  });
}

export async function reverseSettlementTx(params: {
  companyId: string;
  settlementId: string;
  userId: string;
  userName: string;
  reason: string;
}) {
  return db.transaction(async (tx) => {
    const [settlement] = await tx
      .select()
      .from(financialSettlements)
      .where(
        and(
          eq(financialSettlements.id, params.settlementId),
          eq(financialSettlements.companyId, params.companyId)
        )
      )
      .limit(1);

    if (!settlement) throw new DomainError("Baixa não encontrada.", 404);
    if (settlement.reversedAt) {
      throw new DomainError("Esta baixa já foi estornada.", 409);
    }

    const [entry] = await tx
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, settlement.entryId))
      .limit(1);
    if (!entry) throw new DomainError("Título não encontrado.", 404);

    await tx
      .update(financialSettlements)
      .set({
        reversedAt: new Date(),
        reversedBy: params.userId,
        reversalReason: params.reason,
      })
      .where(eq(financialSettlements.id, settlement.id));

    const newPaid = Math.max(
      0,
      roundMoney(toNumber(entry.paidAmount) - toNumber(settlement.amount))
    );
    const newStatus = newPaid > 0 ? "partial" : "open";

    const [updated] = await tx
      .update(financialEntries)
      .set({
        paidAmount: newPaid.toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(financialEntries.id, entry.id))
      .returning();

    await recordAudit(
      {
        companyId: params.companyId,
        establishmentId: entry.establishmentId,
        userId: params.userId,
        userName: params.userName,
        action: "financial_settlement_reversed",
        entity: "financial_entry",
        entityId: entry.id,
        previousData: { paidAmount: entry.paidAmount, status: entry.status },
        newData: { paidAmount: newPaid, status: newStatus, reason: params.reason },
      },
      tx as unknown as typeof db
    );

    return updated;
  });
}
