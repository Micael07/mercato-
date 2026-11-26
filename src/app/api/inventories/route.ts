import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  inventories,
  inventoryItems,
  products,
  productStocks,
  users,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "stock.inventory");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const rows = await db
    .select({
      id: inventories.id,
      code: inventories.code,
      description: inventories.description,
      status: inventories.status,
      openedAt: inventories.openedAt,
      closedAt: inventories.closedAt,
      openedByName: users.name,
      notes: inventories.notes,
      totalItems: sql<number>`(select count(*)::int from inventory_items ii where ii.inventory_id = ${inventories.id})`,
      countedItems: sql<number>`(select count(*)::int from inventory_items ii where ii.inventory_id = ${inventories.id} and (ii.counted_quantity is not null or ii.recount_quantity is not null))`,
    })
    .from(inventories)
    .leftJoin(users, eq(inventories.openedBy, users.id))
    .where(
      and(
        eq(inventories.companyId, ctx.company.id),
        eq(inventories.establishmentId, ctx.establishment.id)
      )
    )
    .orderBy(desc(inventories.openedAt));

  return NextResponse.json({ items: rows });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "stock.inventory");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const description = String(body?.description ?? "").trim();
  const productIds: string[] = Array.isArray(body?.productIds)
    ? body.productIds
    : [];

  const categoryId = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;

  if (!description) {
    return NextResponse.json(
      { error: "Informe uma descrição para o inventário." },
      { status: 400 }
    );
  }

  let created;
  try {
    created = await db.transaction(async (tx) => {
    const code = `INV-${Date.now().toString().slice(-6)}`;
    const [inv] = await tx
      .insert(inventories)
      .values({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        code,
        description,
        status: "counting",
        openedBy: ctx.user.id,
        notes: body?.notes ? String(body.notes) : null,
      })
      .returning();

    const prodConds = [
      eq(products.companyId, ctx.company.id),
      eq(products.status, "active"),
      eq(products.trackStock, true),
    ];
    if (categoryId) prodConds.push(eq(products.categoryId, categoryId));
    if (productIds.length > 0) {
      prodConds.push(inArray(products.id, productIds));
    }

    const prods = await tx
      .select({
        id: products.id,
        qty: productStocks.quantity,
      })
      .from(products)
      .leftJoin(
        productStocks,
        and(
          eq(productStocks.productId, products.id),
          eq(productStocks.establishmentId, ctx.establishment.id)
        )
      )
      .where(and(...prodConds));

    if (prods.length === 0) {
      throw new Error("EMPTY_SCOPE");
    }
    {
      await tx.insert(inventoryItems).values(
        prods.map((p) => ({
          inventoryId: inv.id,
          productId: p.id,
          systemQuantity: toNumber(p.qty ?? 0).toFixed(3),
        }))
      );
    }

    return inv;
  });
  } catch (err) {
    if (err instanceof Error && err.message === "EMPTY_SCOPE") {
      return NextResponse.json(
        { error: "Nenhum produto ativo com controle de estoque neste filtro." },
        { status: 400 }
      );
    }
    throw err;
  }

  return NextResponse.json({ item: created }, { status: 201 });
}
