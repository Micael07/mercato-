import { NextResponse } from "next/server";
import { runDevelopmentSeed } from "@/lib/seed";

export async function POST() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_SEED !== "true"
  ) {
    return NextResponse.json(
      { error: "Seed de desenvolvimento desabilitado em produção." },
      { status: 403 }
    );
  }
  try {
    const result = await runDevelopmentSeed();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Seed error:", err);
    return NextResponse.json(
      { error: "Erro ao executar seed de desenvolvimento." },
      { status: 500 }
    );
  }
}
