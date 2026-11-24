import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db, suppliers } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "purchases.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const conds = [eq(suppliers.companyId, ctx.company.id)];
  if (q) {
    conds.push(
      or(
        ilike(suppliers.legalName, `%${q}%`),
        ilike(suppliers.tradeName, `%${q}%`),
        ilike(suppliers.document, `%${q}%`)
      )!
    );
  }

  const items = await db
    .select()
    .from(suppliers)
    .where(and(...conds))
    .orderBy(asc(suppliers.legalName));

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const legalName = String(body?.legalName ?? "").trim();
  if (!legalName) {
    return NextResponse.json(
      { error: "Razão social / Nome é obrigatório." },
      { status: 400 }
    );
  }

  const [item] = await db
    .insert(suppliers)
    .values({
      companyId: ctx.company.id,
      code:
        String(body?.code ?? "").trim() ||
        `FOR-${Math.floor(100 + Math.random() * 900)}`,
      personType: String(body?.personType ?? "PJ"),
      document: body?.document ? String(body.document).replace(/\D/g, "") : null,
      legalName,
      tradeName: body?.tradeName ? String(body.tradeName).trim() : legalName,
      contactName: body?.contactName ? String(body.contactName).trim() : null,
      phone: body?.phone ? String(body.phone).trim() : null,
      whatsapp: body?.whatsapp ? String(body.whatsapp).trim() : null,
      email: body?.email ? String(body.email).trim() : null,
      address: body?.address ? String(body.address).trim() : null,
      city: body?.city ? String(body.city).trim() : null,
      state: body?.state ? String(body.state).trim().slice(0, 2).toUpperCase() : null,
      zipCode: body?.zipCode ? String(body.zipCode).trim() : null,
      paymentTerms: body?.paymentTerms ? String(body.paymentTerms).trim() : null,
      notes: body?.notes ? String(body.notes) : null,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "supplier_created",
    entity: "supplier",
    entityId: item.id,
    newData: { legalName: item.legalName, document: item.document },
  });

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "ID obrigatório." }, { status: 400 });

  const [updated] = await db
    .update(suppliers)
    .set({
      legalName: body?.legalName ? String(body.legalName).trim() : undefined,
      tradeName: body?.tradeName !== undefined ? body.tradeName : undefined,
      document: body?.document !== undefined ? body.document : undefined,
      contactName: body?.contactName !== undefined ? body.contactName : undefined,
      phone: body?.phone !== undefined ? body.phone : undefined,
      whatsapp: body?.whatsapp !== undefined ? body.whatsapp : undefined,
      email: body?.email !== undefined ? body.email : undefined,
      city: body?.city !== undefined ? body.city : undefined,
      state: body?.state !== undefined ? body.state : undefined,
      paymentTerms: body?.paymentTerms !== undefined ? body.paymentTerms : undefined,
      status: body?.status !== undefined ? body.status : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(suppliers.id, id), eq(suppliers.companyId, ctx.company.id)))
    .returning();

  return NextResponse.json({ item: updated });
}
