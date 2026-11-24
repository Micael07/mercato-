import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  products,
  productPriceHistory,
  stockMovements,
  productStocks,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "products.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;
  const canViewCost = ctx.permissions.has("products.view_cost");

  const [prod] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.companyId, ctx.company.id)))
    .limit(1);

  if (!prod) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  const [stock] = await db
    .select()
    .from(productStocks)
    .where(
      and(
        eq(productStocks.productId, prod.id),
        eq(productStocks.establishmentId, ctx.establishment.id)
      )
    )
    .limit(1);

  const priceHistory = canViewCost
    ? await db
        .select({
          id: productPriceHistory.id,
          previousCost: productPriceHistory.previousCost,
          newCost: productPriceHistory.newCost,
          previousPrice: productPriceHistory.previousPrice,
          newPrice: productPriceHistory.newPrice,
          reason: productPriceHistory.reason,
          createdAt: productPriceHistory.createdAt,
          changedByName: users.name,
        })
        .from(productPriceHistory)
        .leftJoin(users, eq(productPriceHistory.changedBy, users.id))
        .where(eq(productPriceHistory.productId, prod.id))
        .orderBy(desc(productPriceHistory.createdAt))
        .limit(30)
    : [];

  const movements = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      previousBalance: stockMovements.previousBalance,
      newBalance: stockMovements.newBalance,
      originDocument: stockMovements.originDocument,
      justification: stockMovements.justification,
      createdAt: stockMovements.createdAt,
      userName: users.name,
    })
    .from(stockMovements)
    .leftJoin(users, eq(stockMovements.userId, users.id))
    .where(
      and(
        eq(stockMovements.productId, prod.id),
        eq(stockMovements.establishmentId, ctx.establishment.id)
      )
    )
    .orderBy(desc(stockMovements.createdAt))
    .limit(40);

  return NextResponse.json({
    item: {
      ...prod,
      costPrice: canViewCost ? toNumber(prod.costPrice) : null,
      marginPercent: canViewCost ? toNumber(prod.marginPercent) : null,
      salePrice: toNumber(prod.salePrice),
      currentStock: toNumber(stock?.quantity ?? 0),
    },
    priceHistory,
    movements,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "products.update");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.companyId, ctx.company.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  const body = await req.json();
  const canViewCost = ctx.permissions.has("products.view_cost");
  const newCost = canViewCost && body?.costPrice !== undefined
    ? toNumber(body.costPrice)
    : toNumber(existing.costPrice);
  const newSale =
    body?.salePrice !== undefined ? toNumber(body.salePrice) : toNumber(existing.salePrice);
  const margin = newCost > 0 ? ((newSale - newCost) / newCost) * 100 : 0;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({
        name: body?.name !== undefined ? String(body.name).trim() : existing.name,
        shortName:
          body?.shortName !== undefined
            ? body.shortName
              ? String(body.shortName).trim()
              : null
            : existing.shortName,
        sku: body?.sku !== undefined ? String(body.sku).trim() : existing.sku,
        barcode:
          body?.barcode !== undefined
            ? body.barcode
              ? String(body.barcode).trim()
              : null
            : existing.barcode,
        categoryId:
          body?.categoryId !== undefined ? body.categoryId || null : existing.categoryId,
        brand: body?.brand !== undefined ? body.brand || null : existing.brand,
        unit: body?.unit !== undefined ? String(body.unit) : existing.unit,
        costPrice: newCost.toFixed(4),
        salePrice: newSale.toFixed(2),
        marginPercent: margin.toFixed(2),
        minStock:
          body?.minStock !== undefined
            ? toNumber(body.minStock).toFixed(3)
            : existing.minStock,
        maxStock:
          body?.maxStock !== undefined
            ? toNumber(body.maxStock).toFixed(3)
            : existing.maxStock,
        location:
          body?.location !== undefined ? body.location || null : existing.location,
        mainSupplierId:
          body?.mainSupplierId !== undefined
            ? body.mainSupplierId || null
            : existing.mainSupplierId,
        allowFractional:
          body?.allowFractional !== undefined
            ? Boolean(body.allowFractional)
            : existing.allowFractional,
        trackStock:
          body?.trackStock !== undefined
            ? Boolean(body.trackStock)
            : existing.trackStock,
        status: body?.status !== undefined ? String(body.status) : existing.status,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    const priceChanged =
      Math.abs(toNumber(existing.salePrice) - newSale) > 0.001 ||
      Math.abs(toNumber(existing.costPrice) - newCost) > 0.0001;

    if (priceChanged) {
      await tx.insert(productPriceHistory).values({
        companyId: ctx.company.id,
        productId: id,
        previousCost: existing.costPrice,
        newCost: newCost.toFixed(4),
        previousPrice: existing.salePrice,
        newPrice: newSale.toFixed(2),
        changedBy: ctx.user.id,
        reason: body?.priceReason ? String(body.priceReason) : "Alteração cadastral",
      });
    }

    const meta = extractRequestMeta(req);
    await recordAudit(
      {
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        action: priceChanged ? "product_price_updated" : "product_updated",
        entity: "product",
        entityId: id,
        previousData: {
          name: existing.name,
          salePrice: existing.salePrice,
          status: existing.status,
        },
        newData: {
          name: row.name,
          salePrice: row.salePrice,
          status: row.status,
        },
        ...meta,
      },
      tx as unknown as typeof db
    );

    return row;
  });

  return NextResponse.json({ item: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "products.delete");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.companyId, ctx.company.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  // Soft-inactivation to preserve movement/sale integrity
  const [updated] = await db
    .update(products)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "product_inactivated",
    entity: "product",
    entityId: id,
    previousData: { status: existing.status },
    newData: { status: "inactive" },
  });

  return NextResponse.json({ item: updated });
}
