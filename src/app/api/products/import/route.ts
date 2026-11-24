import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, products, productStocks } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "products.create");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha válida encontrada para importação." },
      { status: 400 }
    );
  }

  let imported = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sku = String(r.sku ?? "").trim();
    const name = String(r.name ?? "").trim();
    if (!sku || !name) {
      errors.push(`Linha ${i + 1}: SKU e descrição são obrigatórios.`);
      continue;
    }

    const [dup] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.companyId, ctx.company.id), eq(products.sku, sku)))
      .limit(1);

    if (dup) {
      errors.push(`Linha ${i + 1}: SKU "${sku}" já cadastrado.`);
      continue;
    }

    const cost = toNumber(r.costPrice ?? 0);
    const sale = toNumber(r.salePrice ?? 0);
    const margin = cost > 0 ? ((sale - cost) / cost) * 100 : 0;

    const [prod] = await db
      .insert(products)
      .values({
        companyId: ctx.company.id,
        internalCode: `IMP-${Date.now().toString().slice(-4)}-${i + 1}`,
        sku,
        barcode: r.barcode ? String(r.barcode).trim() : null,
        name,
        unit: r.unit ? String(r.unit).trim() : "UN",
        costPrice: cost.toFixed(4),
        salePrice: sale.toFixed(2),
        marginPercent: margin.toFixed(2),
        minStock: toNumber(r.minStock ?? 0).toFixed(3),
      })
      .returning();

    await db.insert(productStocks).values({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      productId: prod.id,
      quantity: toNumber(r.stock ?? 0).toFixed(3),
    });

    imported++;
  }

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "products_csv_imported",
    entity: "product",
    newData: { imported, errorsCount: errors.length },
  });

  return NextResponse.json({ imported, errors });
}
