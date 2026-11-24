import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, companySettings } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "settings.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, ctx.company.id))
    .limit(1);

  return NextResponse.json({ settings: row });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "settings.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const [previous] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, ctx.company.id))
    .limit(1);

  const [updated] = await db
    .update(companySettings)
    .set({
      allowNegativeStock:
        body?.allowNegativeStock !== undefined
          ? Boolean(body.allowNegativeStock)
          : undefined,
      allowDuplicateBarcode:
        body?.allowDuplicateBarcode !== undefined
          ? Boolean(body.allowDuplicateBarcode)
          : undefined,
      maxDiscountPercent:
        body?.maxDiscountPercent !== undefined
          ? toNumber(body.maxDiscountPercent).toFixed(2)
          : undefined,
      managerMaxDiscountPercent:
        body?.managerMaxDiscountPercent !== undefined
          ? toNumber(body.managerMaxDiscountPercent).toFixed(2)
          : undefined,
      decimalPlaces:
        body?.decimalPlaces !== undefined ? Number(body.decimalPlaces) : undefined,
      currency: body?.currency ? String(body.currency) : undefined,
      timezone: body?.timezone ? String(body.timezone) : undefined,
      dateFormat: body?.dateFormat ? String(body.dateFormat) : undefined,
      requireOpenCashRegister:
        body?.requireOpenCashRegister !== undefined
          ? Boolean(body.requireOpenCashRegister)
          : undefined,
      singleOpenCashPerOperator:
        body?.singleOpenCashPerOperator !== undefined
          ? Boolean(body.singleOpenCashPerOperator)
          : undefined,
      receiptFooter:
        body?.receiptFooter !== undefined ? String(body.receiptFooter) : undefined,
      thermalPrintEnabled:
        body?.thermalPrintEnabled !== undefined
          ? Boolean(body.thermalPrintEnabled)
          : undefined,
      nextSaleNumber:
        body?.nextSaleNumber !== undefined ? Number(body.nextSaleNumber) : undefined,
      nextPurchaseNumber:
        body?.nextPurchaseNumber !== undefined
          ? Number(body.nextPurchaseNumber)
          : undefined,
      updatedAt: new Date(),
    })
    .where(eq(companySettings.companyId, ctx.company.id))
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "settings_updated",
    entity: "company_settings",
    entityId: updated.id,
    previousData: previous,
    newData: updated,
  });

  return NextResponse.json({ settings: updated });
}
