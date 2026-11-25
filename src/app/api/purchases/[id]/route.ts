import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  purchaseOrders,
  purchaseOrderItems,
  purchaseReceipts,
  products,
  suppliers,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { DomainError, receivePurchaseOrderTx } from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "purchases.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [po] = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.tradeName,
      supplierLegalName: suppliers.legalName,
      supplierDocument: suppliers.document,
      supplierContact: suppliers.contactName,
      supplierPhone: suppliers.phone,
      supplierEmail: suppliers.email,
      supplierAddress: suppliers.address,
      supplierCity: suppliers.city,
      supplierState: suppliers.state,
      status: purchaseOrders.status,
      subtotal: purchaseOrders.subtotal,
      discount: purchaseOrders.discount,
      freight: purchaseOrders.freight,
      taxes: purchaseOrders.taxes,
      total: purchaseOrders.total,
      paymentTerms: purchaseOrders.paymentTerms,
      expectedDelivery: purchaseOrders.expectedDelivery,
      notes: purchaseOrders.notes,
      createdByName: users.name,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
    .where(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, ctx.company.id))
    )
    .limit(1);

  if (!po) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      productName: products.name,
      sku: products.sku,
      unit: products.unit,
      quantityOrdered: purchaseOrderItems.quantityOrdered,
      quantityReceived: purchaseOrderItems.quantityReceived,
      unitCost: purchaseOrderItems.unitCost,
      discount: purchaseOrderItems.discount,
      total: purchaseOrderItems.total,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, po.id));

  const receipts = await db
    .select({
      id: purchaseReceipts.id,
      invoiceNumber: purchaseReceipts.invoiceNumber,
      notes: purchaseReceipts.notes,
      receivedAt: purchaseReceipts.receivedAt,
      receivedByName: users.name,
    })
    .from(purchaseReceipts)
    .leftJoin(users, eq(purchaseReceipts.receivedBy, users.id))
    .where(eq(purchaseReceipts.purchaseOrderId, po.id))
    .orderBy(desc(purchaseReceipts.receivedAt));

  return NextResponse.json({
    header: {
      companyName: ctx.company.tradeName || ctx.company.legalName,
      companyCnpj: ctx.company.cnpj,
      establishmentName: ctx.establishment.name,
      establishmentAddress: ctx.establishment.address,
      establishmentPhone: ctx.establishment.phone,
    },
    order: {
      ...po,
      subtotal: toNumber(po.subtotal),
      discount: toNumber(po.discount),
      freight: toNumber(po.freight),
      taxes: toNumber(po.taxes),
      total: toNumber(po.total),
    },
    items: items.map((i) => ({
      ...i,
      quantityOrdered: toNumber(i.quantityOrdered),
      quantityReceived: toNumber(i.quantityReceived),
      unitCost: toNumber(i.unitCost),
      discount: toNumber(i.discount),
      total: toNumber(i.total),
    })),
    receipts,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const body = await req.json();
  const status = String(body?.status ?? "");
  const allowed = ["draft", "pending_approval", "approved", "sent", "cancelled"];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const [current] = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, ctx.company.id)))
    .limit(1);
  if (!current) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  if (["received", "partially_received", "cancelled"].includes(current.status)) {
    return NextResponse.json(
      {
        error:
          current.status === "cancelled"
            ? "Pedido já cancelado."
            : "Pedido com mercadoria recebida não pode mudar de status.",
      },
      { status: 409 }
    );
  }

  const [updated] = await db
    .update(purchaseOrders)
    .set({
      status,
      approvedBy: status === "approved" ? ctx.user.id : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, ctx.company.id))
    )
    .returning();

  return NextResponse.json({ order: updated });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const order = await receivePurchaseOrderTx({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      purchaseOrderId: id,
      invoiceNumber: body?.invoiceNumber ? String(body.invoiceNumber) : undefined,
      notes: body?.notes ? String(body.notes) : undefined,
      userId: ctx.user.id,
      userName: ctx.user.name,
      generatePayable: body?.generatePayable !== false,
      dueDate: body?.dueDate ? String(body.dueDate) : undefined,
      items: Array.isArray(body?.items) ? body.items : [],
    });

    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Receive PO error:", err);
    return NextResponse.json(
      { error: "Erro ao registrar recebimento." },
      { status: 500 }
    );
  }
}
