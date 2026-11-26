import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, categories, products, productStocks, productPriceHistory, stockMovements } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { extractRequestMeta, recordAudit } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  categoryKey,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  normalizeImportRow,
  type NormalizedProduct,
  type RawImportRow,
} from "@/lib/product-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RowStatus = "create" | "update" | "skip" | "error";
interface RowResult {
  line: number;
  name: string;
  status: RowStatus;
  message?: string;
  warnings?: string[];
}

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const margin = (cost: number, sale: number) => (cost > 0 ? ((sale - cost) / cost) * 100 : 0);

/**
 * POST { rows, mode: "skip" | "update", dryRun }
 * dryRun apenas valida e devolve o que seria feito. Sem dryRun, grava as linhas válidas
 * numa única transação (tudo ou nada para as linhas válidas).
 */
export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "products.create");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json().catch(() => null);
  const rawRows: RawImportRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const mode: "skip" | "update" = body?.mode === "update" ? "update" : "skip";
  const dryRun = body?.dryRun !== false;

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha encontrada na planilha." }, { status: 400 });
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Limite de ${MAX_IMPORT_ROWS} produtos por importação. Divida a planilha em partes.` },
      { status: 400 }
    );
  }
  if (mode === "update" && !ctx.permissions.has("products.update")) {
    return NextResponse.json({ error: "Você não tem permissão para atualizar produtos existentes." }, { status: 403 });
  }
  if (!dryRun) {
    const limit = checkRateLimit(`product-import:${ctx.company.id}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  }

  // 1) Validação linha a linha (o navegador também valida, mas o servidor não confia nele).
  const results: RowResult[] = [];
  const valid: NormalizedProduct[] = [];
  const allowedKeys = new Set<string>(["line", ...IMPORT_FIELDS.map((f) => f.key)]);
  rawRows.forEach((r, idx) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r ?? {})) if (allowedKeys.has(k)) clean[k] = typeof v === "string" ? v : v == null ? "" : String(v);
    const line = Number(clean.line) || idx + 2;
    const res = normalizeImportRow({ ...(clean as RawImportRow), line });
    if (res.errors.length || !res.value) {
      results.push({ line, name: String(clean.name ?? ""), status: "error", message: res.errors.join(" ") });
    } else {
      res.value.line = line;
      valid.push(res.value);
      results.push({ line, name: res.value.name, status: "create", warnings: res.warnings.length ? res.warnings : undefined });
    }
  });
  const byLine = new Map(results.map((r) => [r.line, r]));

  // 2) Cruzamento com o cadastro existente.
  const existing = await db
    .select({ id: products.id, sku: products.sku, barcode: products.barcode, costPrice: products.costPrice, salePrice: products.salePrice })
    .from(products)
    .where(eq(products.companyId, ctx.company.id));
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode as string, p]));
  const usedSkus = new Set(existing.map((p) => p.sku));
  const barcodeOwner = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode as string, p.id]));

  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const toCreate: NormalizedProduct[] = [];
  const toUpdate: Array<{ row: NormalizedProduct; target: (typeof existing)[number] }> = [];

  for (const row of valid) {
    const res = byLine.get(row.line)!;
    // Duplicidade dentro da própria planilha
    if (row.sku && seenSku.has(row.sku)) {
      res.status = "error";
      res.message = `SKU "${row.sku}" repetido na planilha (linha ${seenSku.get(row.sku)}).`;
      continue;
    }
    if (row.barcode && seenBarcode.has(row.barcode)) {
      res.status = "error";
      res.message = `Código de barras repetido na planilha (linha ${seenBarcode.get(row.barcode)}).`;
      continue;
    }
    if (row.sku) seenSku.set(row.sku, row.line);
    if (row.barcode) seenBarcode.set(row.barcode, row.line);

    const target = (row.sku && bySku.get(row.sku)) || (row.barcode && byBarcode.get(row.barcode)) || null;
    if (target) {
      if (mode === "skip") {
        res.status = "skip";
        res.message = "Já cadastrado (ignorado).";
      } else {
        // Se o EAN novo já pertence a outro produto, não deixa trocar.
        if (row.barcode && barcodeOwner.get(row.barcode) && barcodeOwner.get(row.barcode) !== target.id) {
          res.status = "error";
          res.message = "Código de barras já pertence a outro produto.";
          continue;
        }
        res.status = "update";
        if (row.stock !== null) (res.warnings ??= []).push("Estoque ignorado: produto já existe (use Estoque ou Inventário).");
        toUpdate.push({ row, target });
      }
      continue;
    }
    if (row.barcode && barcodeOwner.has(row.barcode)) {
      res.status = "error";
      res.message = "Código de barras já cadastrado em outro produto.";
      continue;
    }
    res.status = "create";
    toCreate.push(row);
  }

  // Categorias novas
  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.companyId, ctx.company.id));
  const catByKey = new Map(catRows.map((c) => [categoryKey(c.name), c.id]));
  const newCategoryNames = new Map<string, string>();
  for (const r of [...toCreate, ...toUpdate.map((u) => u.row)]) {
    if (r.category && !catByKey.has(categoryKey(r.category)) && !newCategoryNames.has(categoryKey(r.category))) {
      newCategoryNames.set(categoryKey(r.category), r.category);
    }
  }

  const summary = {
    total: results.length,
    create: results.filter((r) => r.status === "create").length,
    update: results.filter((r) => r.status === "update").length,
    skip: results.filter((r) => r.status === "skip").length,
    error: results.filter((r) => r.status === "error").length,
    newCategories: [...newCategoryNames.values()],
  };

  if (dryRun) {
    return NextResponse.json({ dryRun: true, summary, rows: results });
  }

  // 3) Gravação
  let autoSeq = existing.length;
  const nextSku = () => {
    let sku: string;
    do {
      autoSeq++;
      sku = `P${String(autoSeq).padStart(6, "0")}`;
    } while (usedSkus.has(sku));
    usedSkus.add(sku);
    return sku;
  };

  try {
    await db.transaction(async (tx) => {
      if (newCategoryNames.size) {
        const inserted = await tx
          .insert(categories)
          .values([...newCategoryNames.values()].map((name) => ({ companyId: ctx.company.id, name })))
          .returning({ id: categories.id, name: categories.name });
        for (const c of inserted) catByKey.set(categoryKey(c.name), c.id);
      }

      for (const part of chunk(toCreate, 300)) {
        const values = part.map((r) => {
          const sku = r.sku ?? nextSku();
          const cost = r.costPrice ?? 0;
          return {
            r,
            sku,
            v: {
              companyId: ctx.company.id,
              internalCode: sku.slice(0, 40),
              sku,
              barcode: r.barcode,
              name: r.name,
              categoryId: r.category ? catByKey.get(categoryKey(r.category)) ?? null : null,
              brand: r.brand,
              unit: r.unit,
              costPrice: cost.toFixed(4),
              salePrice: r.salePrice.toFixed(2),
              marginPercent: margin(cost, r.salePrice).toFixed(2),
              minStock: (r.minStock ?? 0).toFixed(3),
              maxStock: (r.maxStock ?? 0).toFixed(3),
              location: r.location,
              expiryDate: r.expiryDate,
              allowFractional: r.allowFractional ?? false,
              status: "active",
            },
          };
        });
        const created = await tx.insert(products).values(values.map((x) => x.v)).returning({ id: products.id, sku: products.sku });
        const idBySku = new Map(created.map((c) => [c.sku, c.id]));

        await tx.insert(productStocks).values(
          values.map((x) => ({
            companyId: ctx.company.id,
            establishmentId: ctx.establishment.id,
            productId: idBySku.get(x.sku)!,
            quantity: (x.r.stock ?? 0).toFixed(3),
          }))
        );
        await tx.insert(productPriceHistory).values(
          values.map((x) => ({
            companyId: ctx.company.id,
            productId: idBySku.get(x.sku)!,
            previousCost: "0.0000",
            newCost: (x.r.costPrice ?? 0).toFixed(4),
            previousPrice: "0.00",
            newPrice: x.r.salePrice.toFixed(2),
            changedBy: ctx.user.id,
            reason: "Importação de planilha",
          }))
        );
        const withStock = values.filter((x) => (x.r.stock ?? 0) > 0);
        if (withStock.length) {
          await tx.insert(stockMovements).values(
            withStock.map((x) => ({
              companyId: ctx.company.id,
              establishmentId: ctx.establishment.id,
              productId: idBySku.get(x.sku)!,
              type: "manual_in",
              quantity: (x.r.stock as number).toFixed(3),
              previousBalance: "0.000",
              newBalance: (x.r.stock as number).toFixed(3),
              unitCost: (x.r.costPrice ?? 0).toFixed(4),
              originDocument: "IMPORTAÇÃO",
              userId: ctx.user.id,
              justification: "Estoque inicial (importação de planilha)",
            }))
          );
        }
      }

      for (const { row, target } of toUpdate) {
        const p = row.provided;
        const patch: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
        if (p.has("name")) patch.name = row.name;
        if (p.has("barcode")) patch.barcode = row.barcode;
        if (p.has("category") && row.category) patch.categoryId = catByKey.get(categoryKey(row.category)) ?? null;
        if (p.has("brand")) patch.brand = row.brand;
        if (p.has("unit")) patch.unit = row.unit;
        if (p.has("minStock")) patch.minStock = (row.minStock ?? 0).toFixed(3);
        if (p.has("maxStock")) patch.maxStock = (row.maxStock ?? 0).toFixed(3);
        if (p.has("location")) patch.location = row.location;
        if (p.has("expiryDate")) patch.expiryDate = row.expiryDate;
        if (p.has("allowFractional")) patch.allowFractional = row.allowFractional ?? false;
        const prevCost = Number(target.costPrice);
        const prevSale = Number(target.salePrice);
        const newCost = p.has("costPrice") ? row.costPrice ?? 0 : prevCost;
        const newSale = row.salePrice; // obrigatório na planilha
        patch.costPrice = newCost.toFixed(4);
        patch.salePrice = newSale.toFixed(2);
        patch.marginPercent = margin(newCost, newSale).toFixed(2);
        await tx.update(products).set(patch).where(and(eq(products.id, target.id), eq(products.companyId, ctx.company.id)));
        if (Math.abs(newCost - prevCost) > 0.00005 || Math.abs(newSale - prevSale) > 0.004) {
          await tx.insert(productPriceHistory).values({
            companyId: ctx.company.id,
            productId: target.id,
            previousCost: prevCost.toFixed(4),
            newCost: newCost.toFixed(4),
            previousPrice: prevSale.toFixed(2),
            newPrice: newSale.toFixed(2),
            changedBy: ctx.user.id,
            reason: "Atualização por planilha",
          });
        }
      }

      const meta = extractRequestMeta(req);
      await recordAudit(
        {
          companyId: ctx.company.id,
          establishmentId: ctx.establishment.id,
          userId: ctx.user.id,
          userName: ctx.user.name,
          action: "products_imported",
          entity: "product",
          newData: { created: toCreate.length, updated: toUpdate.length, skipped: summary.skip, errors: summary.error, mode },
          ...meta,
        },
        tx as unknown as typeof db
      );
    });
  } catch (err) {
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      return NextResponse.json(
        { error: "Outro cadastro alterou SKU ou código de barras durante a importação. Nada foi gravado — tente de novo." },
        { status: 409 }
      );
    }
    console.error("Product import error:", err);
    return NextResponse.json({ error: "Erro ao importar. Nenhum produto foi gravado." }, { status: 500 });
  }

  return NextResponse.json({ dryRun: false, imported: true, summary, rows: results });
}
