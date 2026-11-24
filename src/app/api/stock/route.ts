import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, stockMovements, products, users } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { DomainError, moveStockTx } from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "stock.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const canViewCost = ctx.permissions.has("products.view_cost");

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type")?.trim();
  const productId = searchParams.get("productId")?.trim();

  const conditions = [
    eq(stockMovements.companyId, ctx.company.id),
    eq(stockMovements.establishmentId, ctx.establishment.id),
  ];
  if (type && type !== "all") conditions.push(eq(stockMovements.type, type));
  if (productId) conditions.push(eq(stockMovements.productId, productId));

  const rows = await db
    .select({
      id: stockMovements.id,
      productId: stockMovements.productId,
      productName: products.name,
      sku: products.sku,
      unit: products.unit,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      previousBalance: stockMovements.previousBalance,
      newBalance: stockMovements.newBalance,
      unitCost: stockMovements.unitCost,
      originDocument: stockMovements.originDocument,
      justification: stockMovements.justification,
      userName: users.name,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .leftJoin(users, eq(stockMovements.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(200);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      quantity: toNumber(r.quantity),
      previousBalance: toNumber(r.previousBalance),
      newBalance: toNumber(r.newBalance),
      unitCost: canViewCost ? toNumber(r.unitCost) : null,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "stock.move");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  try {
    const body = await req.json();
    const productId = String(body?.productId ?? "");
    const type = String(body?.type ?? "manual_in") as
      | "manual_in"
      | "manual_out"
      | "adjustment_pos"
      | "adjustment_neg";
    const quantity = toNumber(body?.quantity ?? 0);
    const justification = String(body?.justification ?? "").trim();

    if (!productId || quantity <= 0 || justification.length < 3) {
      return NextResponse.json(
        { error: "Informe produto, quantidade positiva e justificativa." },
        { status: 400 }
      );
    }

    const result = await moveStockTx({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      productId,
      type,
      quantity,
      originDocument: body?.originDocument ? String(body.originDocument) : "MANUAL",
      userId: ctx.user.id,
      userName: ctx.user.name,
      justification,
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Stock move error:", err);
    return NextResponse.json(
      { error: "Erro ao movimentar estoque." },
      { status: 500 }
    );
  }
}
