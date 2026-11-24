import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, paymentMethods } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "sales.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const items = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.companyId, ctx.company.id))
    .orderBy(asc(paymentMethods.sortOrder));

  return NextResponse.json({
    items: items.map((i) => ({ ...i, feePercent: toNumber(i.feePercent) })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "settings.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const name = String(body?.name ?? "").trim();
  const code = String(body?.code ?? "other").trim();
  if (!name) {
    return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });
  }

  const [item] = await db
    .insert(paymentMethods)
    .values({
      companyId: ctx.company.id,
      name,
      code,
      allowsInstallments: Boolean(body?.allowsInstallments ?? false),
      maxInstallments: Number(body?.maxInstallments ?? 1),
      feePercent: toNumber(body?.feePercent ?? 0).toFixed(2),
      isActive: body?.isActive !== false,
    })
    .returning();

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "settings.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "ID obrigatório." }, { status: 400 });

  const [updated] = await db
    .update(paymentMethods)
    .set({
      isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined,
      feePercent:
        body?.feePercent !== undefined
          ? toNumber(body.feePercent).toFixed(2)
          : undefined,
      maxInstallments:
        body?.maxInstallments !== undefined
          ? Number(body.maxInstallments)
          : undefined,
    })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.companyId, ctx.company.id)))
    .returning();

  return NextResponse.json({ item: updated });
}
