import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  db,
  sales,
  saleItems,
  salePayments,
  customers,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { cancelSaleTx, DomainError, moveStockInTx } from "@/lib/services/erp";
import { recordAudit } from "@/lib/audit";
import { roundMoney, toNumber } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "sales.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [sale] = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      customerId: sales.customerId,
      customerName: customers.name,
      customerDocument: customers.document,
      operatorName: users.name,
      status: sales.status,
      subtotal: sales.subtotal,
      discountTotal: sales.discountTotal,
      surchargeTotal: sales.surchargeTotal,
      total: sales.total,
      changeAmount: sales.changeAmount,
      notes: sales.notes,
      cancelReason: sales.cancelReason,
      cancelledAt: sales.cancelledAt,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.operatorId, users.id))
    .where(and(eq(sales.id, id), eq(sales.companyId, ctx.company.id)))
    .limit(1);

  if (!sale) {
    return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
  }

  const items = await db
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, sale.id));

  const payments = await db
    .select()
    .from(salePayments)
    .where(eq(salePayments.saleId, sale.id));

  return NextResponse.json({
    sale: {
      ...sale,
      subtotal: toNumber(sale.subtotal),
      discountTotal: toNumber(sale.discountTotal),
      surchargeTotal: toNumber(sale.surchargeTotal),
      total: toNumber(sale.total),
      changeAmount: toNumber(sale.changeAmount),
    },
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      quantity: toNumber(i.quantity),
      unitPrice: toNumber(i.unitPrice),
      discountAmount: toNumber(i.discountAmount),
      total: toNumber(i.total),
      returnedQuantity: toNumber(i.returnedQuantity),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentMethodName: p.paymentMethodName,
      paymentMethodCode: p.paymentMethodCode,
      amount: toNumber(p.amount),
      installments: p.installments,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "sales.cancel");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const body = await req.json();
  const action = String(body?.action ?? "cancel");

  if (action === "cancel") {
    try {
      const updated = await cancelSaleTx({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        saleId: id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        reason: String(body?.reason ?? ""),
      });
      return NextResponse.json({ sale: updated });
    } catch (err) {
      if (err instanceof DomainError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json(
        { error: "Erro ao cancelar venda." },
        { status: 500 }
      );
    }
  }

  if (action === "return") {
    const returnItems: Array<{ saleItemId: string; quantity: number }> =
      Array.isArray(body?.items) ? body.items : [];
    const reason = String(body?.reason ?? "Devolução de cliente").trim();

    if (returnItems.length === 0) {
      return NextResponse.json(
        { error: "Selecione os itens para devolução." },
        { status: 400 }
      );
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [sale] = await tx
          .select()
          .from(sales)
          .where(and(eq(sales.id, id), eq(sales.companyId, ctx.company.id)))
          .limit(1);
        if (!sale || sale.status === "cancelled" || sale.status === "suspended") {
          throw new DomainError("Venda não elegível para devolução.", 409);
        }

        const items = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.saleId, sale.id));
        const itemMap = new Map(items.map((i) => [i.id, i]));

        for (const r of returnItems) {
          if (r.quantity <= 0) continue;
          const si = itemMap.get(r.saleItemId);
          if (!si) throw new DomainError("Item não pertence à venda.");
          const available = roundMoney(
            toNumber(si.quantity) - toNumber(si.returnedQuantity)
          );
          if (r.quantity > available + 0.001) {
            throw new DomainError(
              `Quantidade de devolução excede o saldo disponível de ${si.productName}.`
            );
          }

          const newRet = Number((toNumber(si.returnedQuantity) + r.quantity).toFixed(3));
          await tx
            .update(saleItems)
            .set({ returnedQuantity: newRet.toFixed(3) })
            .where(eq(saleItems.id, si.id));

          await moveStockInTx(tx, {
            companyId: ctx.company.id,
            establishmentId: sale.establishmentId,
            productId: si.productId,
            type: "return_in",
            deltaQuantity: r.quantity,
            unitCost: toNumber(si.costPriceSnapshot),
            originDocument: `DEV VENDA #${sale.saleNumber}`,
            originId: sale.id,
            userId: ctx.user.id,
            userName: ctx.user.name,
            justification: reason,
          });
        }

        const refreshed = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.saleId, sale.id));
        const allReturned = refreshed.every(
          (i) => toNumber(i.returnedQuantity) + 0.001 >= toNumber(i.quantity)
        );
        const newStatus = allReturned ? "returned" : "partially_returned";

        const [u] = await tx
          .update(sales)
          .set({ status: newStatus })
          .where(eq(sales.id, sale.id))
          .returning();

        await recordAudit(
          {
            companyId: ctx.company.id,
            establishmentId: sale.establishmentId,
            userId: ctx.user.id,
            userName: ctx.user.name,
            action: "sale_returned",
            entity: "sale",
            entityId: sale.id,
            newData: { status: newStatus, reason, returnItems },
          },
          tx as unknown as typeof db
        );

        return u;
      });
      return NextResponse.json({ sale: updated });
    } catch (err) {
      if (err instanceof DomainError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json(
        { error: "Erro ao registrar devolução." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
