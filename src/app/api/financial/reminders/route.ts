import { NextResponse } from "next/server";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, financialEntries } from "@/db";
import { requireApiAuth } from "@/lib/auth";
import { addDaysStr, todayInTz } from "@/lib/dates";
import { roundMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Contas a pagar vencidas e que vencem nos próximos 3 dias. Só administrador e gerente. */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "finance.read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  if (ctx.membership.roleCode !== "admin" && ctx.membership.roleCode !== "manager") {
    return NextResponse.json({ overdue: { count: 0, amount: 0 }, soon: { count: 0, amount: 0 }, today: { count: 0, amount: 0 } });
  }
  const today = todayInTz();
  const limit = addDaysStr(today, 3);
  const rows = await db
    .select({ due: financialEntries.dueDate, open: sql<number>`(${financialEntries.amount} - ${financialEntries.paidAmount})::float8` })
    .from(financialEntries)
    .where(and(
      eq(financialEntries.companyId, ctx.company.id),
      eq(financialEntries.type, "payable"),
      inArray(financialEntries.status, ["open", "partial", "overdue"]),
      lte(financialEntries.dueDate, limit),
    ));
  const sum = (list: typeof rows) => ({ count: list.length, amount: roundMoney(list.reduce((a, r) => a + Number(r.open), 0)) });
  return NextResponse.json({
    overdue: sum(rows.filter((r) => String(r.due) < today)),
    today: sum(rows.filter((r) => String(r.due) === today)),
    soon: sum(rows.filter((r) => String(r.due) > today)),
  });
}
