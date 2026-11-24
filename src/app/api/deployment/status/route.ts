import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireDeploymentAdmin } from "@/lib/deployment/access";
import {
  canExportSource,
  environmentChecks,
  releaseLimitations,
  type DeploymentCheck,
  type DeploymentStatus,
} from "@/lib/deployment/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireDeploymentAdmin(req);
    if ("error" in auth) return auth.error;

    const checks: DeploymentCheck[] = environmentChecks(process.env);
    try {
      const tables = await db.execute<{ name: string; present: boolean }>(sql`
        SELECT name, to_regclass(name) IS NOT NULL AS present
        FROM unnest(ARRAY[
          'public.users', 'public.companies', 'public.establishments',
          'public.products', 'public.sales', 'public.stock_movements',
          'public.cash_registers', 'public.financial_entries'
        ]) AS required(name)
      `);
      checks.unshift({
        id: "database-connectivity",
        label: "Conectividade com PostgreSQL",
        state: "ok",
        detail: "Consulta de diagnóstico concluída. Nenhuma conexão, senha ou informação de cliente é exibida.",
      });
      const complete = tables.rows.every((table) => table.present);
      checks.splice(1, 0, {
        id: "schema-presence",
        label: "Tabelas principais",
        state: complete ? "ok" : "error",
        detail: complete
          ? "As tabelas principais foram localizadas. Presença de tabelas não comprova integridade de todas as constraints ou policies."
          : "Há tabelas principais ausentes. Confira o banco selecionado e as migrations antes de continuar.",
      });
      const history = await db.execute<{ present: boolean }>(sql`
        SELECT to_regclass('mercato_meta.schema_migrations') IS NOT NULL AS present
      `);
      checks.splice(2, 0, {
        id: "migration-history",
        label: "Histórico do executor de migrations",
        state: history.rows[0]?.present ? "ok" : "warning",
        detail: history.rows[0]?.present
          ? "A tabela de histórico existe. Execute o script de migrations para conferir os checksums dos arquivos."
          : "Histórico não localizado. Instalações locais via Drizzle podem não tê-lo; não reaplique migrations à força em um banco existente.",
      });
    } catch {
      checks.unshift({
        id: "database-connectivity",
        label: "Consulta de diagnóstico",
        state: "error",
        detail: "Não foi possível concluir a consulta ao banco. Consulte os logs privados, sem compartilhar credenciais.",
      });
    }

    const result: DeploymentStatus = {
      checkedAt: new Date().toISOString(),
      mode: process.env.DEPLOYMENT_TARGET === "public" ? "public" : "preview",
      checks,
      sourceExportEnabled: canExportSource(process.env),
      commercialReleaseApproved: false,
      limitations: releaseLimitations,
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a publicação. Verifique a sessão e os logs privados do servidor." }, { status: 503 });
  }
}
