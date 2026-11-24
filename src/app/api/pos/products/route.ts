import { NextResponse } from "next/server";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, categories, products, productStocks } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { isUuid } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireApiAuth(req, "sales.create");
    if ("error" in auth) return auth.error;
    const { ctx } = auth;
    const params = new URL(req.url).searchParams;
    const query = (params.get("q") || "").trim().slice(0, 120);
    const ids = params.get("ids")?.split(",").filter(Boolean);
    if (ids && (ids.length === 0 || ids.length > 200 || !ids.every(isUuid))) {
      return NextResponse.json({ error: "Lista de produtos inválida." }, { status: 400 });
    }
    const offset = Number(params.get("offset") || 0);
    const requestedLimit = Number(params.get("limit") || 50);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return NextResponse.json({ error: "Paginação inválida." }, { status: 400 });
    }
    const limit = ids ? ids.length : requestedLimit;
    const conditions = [eq(products.companyId, ctx.company.id), eq(products.status, "active")];
    if (ids?.length) conditions.push(inArray(products.id, ids));
    if (query) conditions.push(or(ilike(products.name, `%${query}%`), ilike(products.sku, `%${query}%`), ilike(products.barcode, `%${query}%`), ilike(products.internalCode, `%${query}%`))!);
    // Explicit projection: this endpoint never selects or returns cost/margin.
    const rows = await db.select({
      id: products.id,
      internalCode: products.internalCode,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      unit: products.unit,
      salePrice: products.salePrice,
      currentStock: productStocks.quantity,
      allowFractional: products.allowFractional,
      trackStock: products.trackStock,
      status: products.status,
      categoryName: categories.name,
    }).from(products)
      .leftJoin(productStocks, and(eq(productStocks.productId, products.id), eq(productStocks.establishmentId, ctx.establishment.id), eq(productStocks.companyId, ctx.company.id)))
      .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.companyId, ctx.company.id)))
      .where(and(...conditions)).orderBy(asc(products.name)).limit(limit + 1).offset(ids ? 0 : offset);
    return NextResponse.json({
      items: rows.slice(0, limit).map((row) => ({ ...row, salePrice: Number(row.salePrice), currentStock: Number(row.currentStock || 0) })),
      hasMore: rows.length > limit,
      offset: ids ? 0 : offset,
      limit,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar os produtos para venda." }, { status: 500 });
  }
}
