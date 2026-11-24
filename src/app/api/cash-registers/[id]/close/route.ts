import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, cashMovements } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { closeCashRegisterTx, DomainError } from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "cash.close");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const countedClosingAmount = toNumber(body?.countedClosingAmount ?? 0);

    const updated = await closeCashRegisterTx({
      companyId: ctx.company.id,
      establishmentId: ctx.establishment.id,
      cashRegisterId: id,
      userId: ctx.user.id,
      userName: ctx.user.name,
      countedClosingAmount,
      differenceJustification: body?.differenceJustification
        ? String(body.differenceJustification)
        : undefined,
      closingNotes: body?.closingNotes ? String(body.closingNotes) : undefined,
    });

    // Build summary by payment method
    const movs = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.cashRegisterId, id));

    const summaryByMethod: Record<string, number> = {};
    for (const m of movs) {
      if (m.type === "sale_in") {
        const key = m.paymentMethodCode || "other";
        summaryByMethod[key] = (summaryByMethod[key] ?? 0) + toNumber(m.amount);
      }
    }

    return NextResponse.json({ register: updated, summaryByMethod });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Close register error:", err);
    return NextResponse.json(
      { error: "Erro ao fechar caixa." },
      { status: 500 }
    );
  }
}
