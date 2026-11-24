import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import {
  DomainError,
  reverseSettlementTx,
  settleFinancialEntryTx,
} from "@/lib/services/erp";
import { toNumber } from "@/lib/format";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, "finance.manage");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  try {
    const body = await req.json();
    if (body?.action === "reverse") {
      const updated = await reverseSettlementTx({
        companyId: ctx.company.id,
        settlementId: String(body?.settlementId ?? id),
        userId: ctx.user.id,
        userName: ctx.user.name,
        reason: String(body?.reason ?? "Estorno operacional"),
      });
      return NextResponse.json({ entry: updated });
    }

    const updated = await settleFinancialEntryTx({
      companyId: ctx.company.id,
      entryId: id,
      amount: toNumber(body?.amount ?? 0),
      interest: toNumber(body?.interest ?? 0),
      penalty: toNumber(body?.penalty ?? 0),
      discount: toNumber(body?.discount ?? 0),
      paymentMethodCode: String(body?.paymentMethodCode ?? "pix"),
      userId: ctx.user.id,
      userName: ctx.user.name,
      notes: body?.notes ? String(body.notes) : undefined,
    });

    return NextResponse.json({ entry: updated });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Settle error:", err);
    return NextResponse.json(
      { error: "Erro ao processar movimentação financeira." },
      { status: 500 }
    );
  }
}
