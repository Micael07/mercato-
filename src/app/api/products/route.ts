import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  products,
  productStocks,
  categories,
  suppliers,
  productPriceHistory,
} from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "products.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const canViewCost = ctx.permissions.has("products.view_cost");
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const categoryId = searchParams.get("categoryId")?.trim();
  const status = searchParams.get("status")?.trim();
  const stockFilter = searchParams.get("stockFilter")?.trim(); // low | zero

  const conditions = [eq(products.companyId, ctx.company.id)];
  if (categoryId) conditions.push(eq(products.categoryId, categoryId));
  if (status && status !== "all") conditions.push(eq(products.status, status));
  if (q) {
    conditions.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.sku, `%${q}%`),
        ilike(products.barcode, `%${q}%`),
        ilike(products.internalCode, `%${q}%`)
      )!
    );
  }

  const rows = await db
    .select({
      id: products.id,
      internalCode: products.internalCode,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      shortName: products.shortName,
      categoryId: products.categoryId,
      categoryName: categories.name,
      brand: products.brand,
      unit: products.unit,
      costPrice: products.costPrice,
      salePrice: products.salePrice,
      marginPercent: products.marginPercent,
      minStock: products.minStock,
      maxStock: products.maxStock,
      location: products.location,
      mainSupplierId: products.mainSupplierId,
      supplierName: suppliers.tradeName,
      imageUrl: products.imageUrl,
      allowFractional: products.allowFractional,
      trackStock: products.trackStock,
      status: products.status,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      currentStock: productStocks.quantity,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(suppliers, eq(products.mainSupplierId, suppliers.id))
    .leftJoin(
      productStocks,
      and(
        eq(productStocks.productId, products.id),
        eq(productStocks.establishmentId, ctx.establishment.id)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(products.createdAt));

  let formatted = rows.map((r) => {
    const qty = toNumber(r.currentStock ?? 0);
    const min = toNumber(r.minStock);
    return {
      id: r.id,
      internalCode: r.internalCode,
      sku: r.sku,
      barcode: r.barcode,
      name: r.name,
      shortName: r.shortName,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      brand: r.brand,
      unit: r.unit,
      costPrice: canViewCost ? toNumber(r.costPrice) : null,
      salePrice: toNumber(r.salePrice),
      marginPercent: canViewCost ? toNumber(r.marginPercent) : null,
      minStock: min,
      maxStock: toNumber(r.maxStock),
      currentStock: qty,
      location: r.location,
      mainSupplierId: r.mainSupplierId,
      supplierName: r.supplierName,
      imageUrl: r.imageUrl,
      allowFractional: r.allowFractional,
      trackStock: r.trackStock,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  if (stockFilter === "low") {
    formatted = formatted.filter((p) => p.trackStock && p.currentStock > 0 && p.currentStock <= p.minStock);
  } else if (stockFilter === "zero") {
    formatted = formatted.filter((p) => p.trackStock && p.currentStock <= 0);
  }

  return NextResponse.json({ items: formatted, canViewCost });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "products.create");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const sku = String(body?.sku ?? "").trim();
    const barcode = body?.barcode ? String(body.barcode).trim() : null;
    const costPrice = toNumber(body?.costPrice ?? 0);
    const salePrice = toNumber(body?.salePrice ?? 0);

    if (!name || !sku) {
      return NextResponse.json(
        { error: "Descrição e SKU são obrigatórios." },
        { status: 400 }
      );
    }

    // Check SKU uniqueness inside company
    const [existingSku] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.companyId, ctx.company.id), eq(products.sku, sku)))
      .limit(1);
    if (existingSku) {
      return NextResponse.json(
        { error: "Já existe um produto com este SKU nesta empresa." },
        { status: 409 }
      );
    }

    if (barcode && !ctx.settings.allowDuplicateBarcode) {
      const [existingBc] = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(eq(products.companyId, ctx.company.id), eq(products.barcode, barcode))
        )
        .limit(1);
      if (existingBc) {
        return NextResponse.json(
          { error: "Código de barras já cadastrado para outro produto nesta empresa." },
          { status: 409 }
        );
      }
    }

    const marginPercent =
      costPrice > 0 ? ((salePrice - costPrice) / costPrice) * 100 : 0;

    const internalCode =
      String(body?.internalCode ?? "").trim() ||
      `PRD-${Math.floor(1000 + Math.random() * 9000)}`;

    const created = await db.transaction(async (tx) => {
      const [prod] = await tx
        .insert(products)
        .values({
          companyId: ctx.company.id,
          internalCode,
          sku,
          barcode: barcode || null,
          name,
          shortName: body?.shortName ? String(body.shortName).trim() : null,
          categoryId: body?.categoryId || null,
          brand: body?.brand ? String(body.brand).trim() : null,
          unit: String(body?.unit ?? "UN"),
          costPrice: costPrice.toFixed(4),
          salePrice: salePrice.toFixed(2),
          marginPercent: marginPercent.toFixed(2),
          minStock: toNumber(body?.minStock ?? 0).toFixed(3),
          maxStock: toNumber(body?.maxStock ?? 0).toFixed(3),
          location: body?.location ? String(body.location).trim() : null,
          mainSupplierId: body?.mainSupplierId || null,
          imageUrl: body?.imageUrl || null,
          allowFractional: Boolean(body?.allowFractional ?? false),
          trackStock: body?.trackStock !== false,
          status: "active",
        })
        .returning();

      const initialQty = toNumber(body?.initialStock ?? 0);
      await tx.insert(productStocks).values({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        productId: prod.id,
        quantity: initialQty.toFixed(3),
      });

      await tx.insert(productPriceHistory).values({
        companyId: ctx.company.id,
        productId: prod.id,
        previousCost: "0.0000",
        newCost: costPrice.toFixed(4),
        previousPrice: "0.00",
        newPrice: salePrice.toFixed(2),
        changedBy: ctx.user.id,
        reason: "Cadastro inicial do produto",
      });

      const meta = extractRequestMeta(req);
      await recordAudit(
        {
          companyId: ctx.company.id,
          establishmentId: ctx.establishment.id,
          userId: ctx.user.id,
          userName: ctx.user.name,
          action: "product_created",
          entity: "product",
          entityId: prod.id,
          newData: { sku, name, salePrice },
          ...meta,
        },
        tx as unknown as typeof db
      );

      return prod;
    });

    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    console.error("Create product error:", err);
    return NextResponse.json(
      { error: "Erro ao cadastrar produto." },
      { status: 500 }
    );
  }
}
