import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, categories } from "@/db";
import { requireApiAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "products.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const items = await db
    .select()
    .from(categories)
    .where(and(eq(categories.companyId, ctx.company.id), eq(categories.isActive, true)))
    .orderBy(asc(categories.name));

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req, "products.create");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "Nome da categoria é obrigatório." },
      { status: 400 }
    );
  }

  const [item] = await db
    .insert(categories)
    .values({
      companyId: ctx.company.id,
      name,
      parentId: body?.parentId || null,
    })
    .returning();

  return NextResponse.json({ item }, { status: 201 });
}
