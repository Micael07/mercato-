import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, cashRegisters, cashMovements, users } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import {
  DomainError,
  openCashRegisterTx,
} from "@/lib/services/erp";
import { recordAudit } from "@/lib/audit";
import { toNumber } from "@/lib/format";

export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "sales.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const registers = await db
    .select({
      id: cashRegisters.id,
      userId: cashRegisters.userId,
      userName: users.name,
      terminalName: cashRegisters.terminalName,
      status: cashRegisters.status,
      openingAmount: cashRegisters.openingAmount,
      currentBalance: cashRegisters.currentBalance,
      expectedClosingAmount: cashRegisters.expectedClosingAmount,
      countedClosingAmount: cashRegisters.countedClosingAmount,
      differenceAmount: cashRegisters.differenceAmount,
      differenceJustification: cashRegisters.differenceJustification,
      openedAt: cashRegisters.openedAt,
      closedAt: cashRegisters.closedAt,
      closingNotes: cashRegisters.closingNotes,
    })
    .from(cashRegisters)
    .leftJoin(users, eq(cashRegisters.userId, users.id))
    .where(
      and(
        eq(cashRegisters.companyId, ctx.company.id),
        eq(cashRegisters.establishmentId, ctx.establishment.id)
      )
    )
    .orderBy(desc(cashRegisters.openedAt))
    .limit(50);

  const openForUser = registers.find(
    (r) => r.status === "open" && r.userId === ctx.user.id
  ) ?? registers.find((r) => r.status === "open") ?? null;

  let movements: Array<Record<string, unknown>> = [];
  if (openForUser) {
    movements = await db
      .select({
        id: cashMovements.id,
        type: cashMovements.type,
        paymentMethodCode: cashMovements.paymentMethodCode,
        amount: cashMovements.amount,
        description: cashMovements.description,
        createdAt: cashMovements.createdAt,
        userName: users.name,
      })
      .from(cashMovements)
      .leftJoin(users, eq(cashMovements.userId, users.id))
      .where(eq(cashMovements.cashRegisterId, openForUser.id))
      .orderBy(desc(cashMovements.createdAt))
      .limit(100);
  }

  return NextResponse.json({
    registers: registers.map((r) => ({
      ...r,
      openingAmount: toNumber(r.openingAmount),
      currentBalance: toNumber(r.currentBalance),
      expectedClosingAmount:
        r.expectedClosingAmount !== null
          ? toNumber(r.expectedClosingAmount)
          : null,
      countedClosingAmount:
        r.countedClosingAmount !== null ? toNumber(r.countedClosingAmount) : null,
      differenceAmount:
        r.differenceAmount !== null ? toNumber(r.differenceAmount) : null,
    })),
    activeRegister: openForUser
      ? {
          ...openForUser,
          openingAmount: toNumber(openForUser.openingAmount),
          currentBalance: toNumber(openForUser.currentBalance),
        }
      : null,
    movements: movements.map((m) => ({
      ...m,
      amount: toNumber(m.amount),
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const action = String(body?.action ?? "open");

  if (action === "open") {
    const auth = await requireApiAuth(req, "cash.open");
    if ("error" in auth) return auth.error;
    const { ctx } = auth;

    try {
      const reg = await openCashRegisterTx({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        userId: ctx.user.id,
        userName: ctx.user.name,
        terminalName: body?.terminalName ? String(body.terminalName) : "Caixa 01",
        openingAmount: toNumber(body?.openingAmount ?? 0),
      });
      return NextResponse.json({ register: reg }, { status: 201 });
    } catch (err) {
      if (err instanceof DomainError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json({ error: "Erro ao abrir caixa." }, { status: 500 });
    }
  }

  if (action === "supply" || action === "bleed") {
    const auth = await requireApiAuth(req, "cash.move");
    if ("error" in auth) return auth.error;
    const { ctx } = auth;

    const cashRegisterId = String(body?.cashRegisterId ?? "");
    const amount = toNumber(body?.amount ?? 0);
    const description = String(body?.description ?? "").trim();

    if (!cashRegisterId || amount <= 0 || !description) {
      return NextResponse.json(
        { error: "Informe caixa, valor positivo e descrição." },
        { status: 400 }
      );
    }

    const updated = await db.transaction(async (tx) => {
      const [reg] = await tx
        .select()
        .from(cashRegisters)
        .where(
          and(
            eq(cashRegisters.id, cashRegisterId),
            eq(cashRegisters.companyId, ctx.company.id),
            eq(cashRegisters.status, "open")
          )
        )
        .limit(1);

      if (!reg) {
        throw new DomainError("Caixa aberto não encontrado.", 404);
      }

      const current = toNumber(reg.currentBalance);
      if (action === "bleed" && current < amount) {
        throw new DomainError(
          `Saldo em dinheiro insuficiente para sangria (Saldo: R$ ${current.toFixed(2)}).`
        );
      }

      const delta = action === "supply" ? amount : -amount;
      const [u] = await tx
        .update(cashRegisters)
        .set({
          currentBalance: sql`${cashRegisters.currentBalance} + ${delta.toFixed(2)}::numeric`,
        })
        .where(eq(cashRegisters.id, reg.id))
        .returning();

      await tx.insert(cashMovements).values({
        companyId: ctx.company.id,
        establishmentId: ctx.establishment.id,
        cashRegisterId: reg.id,
        type: action,
        paymentMethodCode: "cash",
        amount: amount.toFixed(2),
        description,
        userId: ctx.user.id,
      });

      await recordAudit(
        {
          companyId: ctx.company.id,
          establishmentId: ctx.establishment.id,
          userId: ctx.user.id,
          userName: ctx.user.name,
          action: action === "supply" ? "cash_supply" : "cash_bleed",
          entity: "cash_register",
          entityId: reg.id,
          newData: { amount, description },
        },
        tx as unknown as typeof db
      );

      return u;
    }).catch((err) => {
      if (err instanceof DomainError) return err;
      throw err;
    });

    if (updated instanceof DomainError) {
      return NextResponse.json({ error: updated.message }, { status: updated.status });
    }

    return NextResponse.json({ register: updated });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
