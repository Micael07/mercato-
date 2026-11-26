import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, inventories, inventoryItems, products, categories } from "@/db";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
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
      costPrice: products.costPrice,
      categoryName: categories.name,
      systemQuantity: inventoryItems.systemQuantity,
      countedQuantity: inventoryItems.countedQuantity,
      recountQuantity: inventoryItems.recountQuantity,
      divergence: inventoryItems.divergence,
      adjusted: inventoryItems.adjusted,
      notes: inventoryItems.notes,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(inventoryItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(inventoryItems.inventoryId, inv.id))
    .orderBy(products.name);

  return NextResponse.json({
    inventory: inv,
    items: items.map((i) => ({
      ...i,
      costPrice: toNumber(i.costPrice),
      categoryName: i.categoryName ?? "Sem categoria",
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

  let ignoreUncounted = false;
  try {
    const b = await req.json();
    ignoreUncounted = b?.ignoreUncounted === true;
  } catch {}

  try {
    const updated = await approveInventoryTx({
      ignoreUncounted,
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

export async function DELETE(
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
    .where(
      and(
        eq(inventories.id, id),
        eq(inventories.companyId, ctx.company.id),
        eq(inventories.establishmentId, ctx.establishment.id)
      )
    )
    .limit(1);
  if (!inv) {
    return NextResponse.json({ error: "Inventário não encontrado." }, { status: 404 });
  }

  // Inventário aprovado já alterou o estoque: só administrador/gerente pode apagar o registro,
  // e os saldos NÃO são revertidos (os movimentos continuam no histórico do estoque).
  if (inv.status === "approved" && !["admin", "manager"].includes(ctx.membership.roleCode)) {
    return NextResponse.json(
      { error: "Apenas administrador ou gerente pode excluir um inventário já aprovado." },
      { status: 403 }
    );
  }

  await db.delete(inventories).where(eq(inventories.id, inv.id));

  const meta = extractRequestMeta(req);
  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "inventory_deleted",
    entity: "inventory",
    entityId: inv.id,
    previousData: { code: inv.code, description: inv.description, status: inv.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
}
