import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: ctx.user,
    isPlatformAdmin: ctx.isPlatformAdmin,
    company: ctx.company,
    establishment: ctx.establishment,
    membership: ctx.membership,
    settings: ctx.settings,
    permissions: Array.from(ctx.permissions),
    availableCompanies: ctx.availableCompanies,
  });
}
