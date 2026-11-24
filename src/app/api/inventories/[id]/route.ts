import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, inventories, inventoryItems, products } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { approveInventoryTx, DomainError } from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "stock.inventory");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [inv] = await db
    .select()
    .from(inventories)
    .where(and(eq(inventories.id, id), eq(inventories.companyId, ctx.company.id)))
    .limit(1);

  if (!inv) {
    return NextResponse.json({ error: "Inventário não encontrado." }, { status: 404 });
  }

  const items = await db
    .select({
      id: inventoryItems.id,
      productId: inventoryItems.productId,
      productName: products.name,
      sku: products.sku,
      unit: products.unit,
      systemQuantity: inventoryItems.systemQuantity,
      countedQuantity: inventoryItems.countedQuantity,
      recountQuantity: inventoryItems.recountQuantity,
      divergence: inventoryItems.divergence,
      adjusted: inventoryItems.adjusted,
      notes: inventoryItems.notes,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(inventoryItems.productId, products.id))
    .where(eq(inventoryItems.inventoryId, inv.id));

  return NextResponse.json({
    inventory: inv,
    items: items.map((i) => ({
      ...i,
      systemQuantity: toNumber(i.systemQuantity),
      countedQuantity: i.countedQuantity !== null ? toNumber(i.countedQuantity) : null,
      recountQuantity: i.recountQuantity !== null ? toNumber(i.recountQuantity) : null,
      divergence: toNumber(i.divergence),
    })),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "stock.inventory");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [inv] = await db
    .select()
    .from(inventories)
    .where(and(eq(inventories.id, id), eq(inventories.companyId, ctx.company.id)))
    .limit(1);
  if (!inv || inv.status === "approved" || inv.status === "cancelled") {
    return NextResponse.json(
      { error: "Inventário não pode ser alterado." },
      { status: 409 }
    );
  }

  const body = await req.json();
  const counts: Array<{
    itemId: string;
    countedQuantity?: number | null;
    recountQuantity?: number | null;
    notes?: string;
  }> = Array.isArray(body?.counts) ? body.counts : [];

  for (const c of counts) {
    await db
      .update(inventoryItems)
      .set({
        countedQuantity:
          c.countedQuantity !== undefined && c.countedQuantity !== null
            ? toNumber(c.countedQuantity).toFixed(3)
            : undefined,
        recountQuantity:
          c.recountQuantity !== undefined && c.recountQuantity !== null
            ? toNumber(c.recountQuantity).toFixed(3)
            : undefined,
        notes: c.notes !== undefined ? c.notes : undefined,
      })
      .where(and(eq(inventoryItems.id, c.itemId), eq(inventoryItems.inventoryId, inv.id)));
  }

  return NextResponse.json({ ok: true });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "stock.inventory");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  try {
    const updated = await approveInventoryTx({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      inventoryId: id,
      userId: ctx.user.id,
      userName: ctx.user.name,
    });
    return NextResponse.json({ inventory: updated });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Erro ao aprovar inventário." },
      { status: 500 }
    );
  }
}
