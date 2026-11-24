import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db, customers } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "customers.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const conds = [eq(customers.companyId, ctx.company.id)];
  if (q) {
    conds.push(
      or(
        ilike(customers.name, `%${q}%`),
        ilike(customers.document, `%${q}%`),
        ilike(customers.phone, `%${q}%`)
      )!
    );
  }

  const rows = await db
    .select()
    .from(customers)
    .where(and(...conds))
    .orderBy(asc(customers.name));

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      creditLimit: toNumber(r.creditLimit),
      openBalance: toNumber(r.openBalance),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "customers.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Nome do cliente é obrigatório." }, { status: 400 });
  }

  const [item] = await db
    .insert(customers)
    .values({
      companyId: ctx.company.id,
      code:
        String(body?.code ?? "").trim() ||
        `CLI-${Math.floor(100 + Math.random() * 900)}`,
      name,
      document: body?.document ? String(body.document).replace(/\D/g, "") : null,
      phone: body?.phone ? String(body.phone).trim() : null,
      whatsapp: body?.whatsapp ? String(body.whatsapp).trim() : null,
      email: body?.email ? String(body.email).trim() : null,
      birthDate: body?.birthDate || null,
      address: body?.address ? String(body.address).trim() : null,
      zipCode: body?.zipCode ? String(body.zipCode).trim() : null,
      city: body?.city ? String(body.city).trim() : null,
      state: body?.state ? String(body.state).trim().slice(0, 2).toUpperCase() : null,
      creditLimit: toNumber(body?.creditLimit ?? 0).toFixed(2),
      notes: body?.notes ? String(body.notes) : null,
    })
    .returning();

  await recordAudit({
    companyId: ctx.company.id,
    establishmentId: ctx.establishment.id,
    userId: ctx.user.id,
    userName: ctx.user.name,
    action: "customer_created",
    entity: "customer",
    entityId: item.id,
    newData: { name: item.name, document: item.document },
  });

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireApiAuth(req, "customers.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "ID obrigatório." }, { status: 400 });

  const [updated] = await db
    .update(customers)
    .set({
      name: body?.name ? String(body.name).trim() : undefined,
      document: body?.document !== undefined ? body.document : undefined,
      phone: body?.phone !== undefined ? body.phone : undefined,
      whatsapp: body?.whatsapp !== undefined ? body.whatsapp : undefined,
      email: body?.email !== undefined ? body.email : undefined,
      address: body?.address !== undefined ? body.address : undefined,
      city: body?.city !== undefined ? body.city : undefined,
      state: body?.state !== undefined ? body.state : undefined,
      creditLimit:
        body?.creditLimit !== undefined
          ? toNumber(body.creditLimit).toFixed(2)
          : undefined,
      status: body?.status !== undefined ? body.status : undefined,
      notes: body?.notes !== undefined ? body.notes : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), eq(customers.companyId, ctx.company.id)))
    .returning();

  return NextResponse.json({ item: updated });
}
