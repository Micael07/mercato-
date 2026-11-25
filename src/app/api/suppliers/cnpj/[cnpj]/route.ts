import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, suppliers } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { lookupCnpj, onlyDigits } from "@/lib/cnpj";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cnpj: string }> }
) {
  const auth = await requireApiAuth(req, "purchases.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { cnpj } = await params;
  const digits = onlyDigits(cnpj);

  const result = await lookupCnpj(digits);
  if (!result.ok) {
    const map = {
      invalid: [400, "CNPJ inválido. Confira os números digitados."],
      not_found: [404, "CNPJ não encontrado na base pública."],
      unavailable: [
        503,
        "Não foi possível consultar o CNPJ agora. Preencha os dados manualmente ou tente de novo em instantes.",
      ],
    } as const;
    const [status, error] = map[result.reason];
    return NextResponse.json({ error }, { status });
  }

  const [existing] = await db
    .select({ id: suppliers.id, legalName: suppliers.legalName })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.document, digits)))
    .limit(1);

  return NextResponse.json({ data: result.data, existing: existing ?? null });
}
