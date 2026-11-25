import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { addDaysStr, endOfDayUtc, isDateStr, startOfDayUtc, todayInTz } from "@/lib/dates";
import { getTeamSales } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Vendas de todos os colaboradores da empresa (visão do administrador). ?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req, "users.manage");
  if ("error" in auth) return auth.error;
  const { searchParams } = new URL(req.url);
  const today = todayInTz();
  const to = isDateStr(searchParams.get("to")) ? searchParams.get("to")! : today;
  const from = isDateStr(searchParams.get("from")) ? searchParams.get("from")! : addDaysStr(to, -29);
  const rows = await getTeamSales(auth.ctx.company.id, startOfDayUtc(from), endOfDayUtc(to));
  return NextResponse.json({ from, to, rows });
}
