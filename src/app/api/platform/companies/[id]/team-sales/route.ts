import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { addDaysStr, endOfDayUtc, isDateStr, startOfDayUtc, todayInTz } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { getTeamSales } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const { searchParams } = new URL(req.url);
  const to = isDateStr(searchParams.get("to")) ? searchParams.get("to")! : todayInTz();
  const from = isDateStr(searchParams.get("from")) ? searchParams.get("from")! : addDaysStr(to, -29);
  return NextResponse.json({ from, to, rows: await getTeamSales(id, startOfDayUtc(from), endOfDayUtc(to)) });
}
