// Exportação completa dos dados de uma empresa: um ZIP com um CSV por tabela (UTF-8, separador ";").
// Nunca inclui senhas, hashes, tokens ou segredos.
import { zipSync, strToU8 } from "fflate";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const SENSITIVE = /password|hash|token|secret|session_valid/i;

interface TableSpec { table: string; where?: string; label?: string }

/** where usa $1 = id da empresa; filhos entram pelo pai. */
const TABLES: TableSpec[] = [
  { table: "establishments" }, { table: "company_settings" }, { table: "payment_methods" },
  { table: "categories" }, { table: "suppliers" }, { table: "customers" },
  { table: "products" }, { table: "product_stocks" }, { table: "product_price_history" },
  { table: "stock_movements" }, { table: "inventories" },
  { table: "inventory_items", where: "inventory_id in (select id from inventories where company_id = $1)" },
  { table: "purchase_orders" },
  { table: "purchase_order_items", where: "purchase_order_id in (select id from purchase_orders where company_id = $1)" },
  { table: "cash_registers" }, { table: "cash_movements" },
  { table: "sales" },
  { table: "sale_items", where: "sale_id in (select id from sales where company_id = $1)" },
  { table: "sale_payments", where: "sale_id in (select id from sales where company_id = $1)" },
  { table: "financial_categories" }, { table: "financial_entries" },
  { table: "audit_logs" },
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "﻿";
  const cols = Object.keys(rows[0]).filter((c) => !SENSITIVE.test(c));
  return "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))].join("\r\n");
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(res) ? res : (res as { rows: Array<Record<string, unknown>> }).rows) as Array<Record<string, unknown>>;
}

export async function buildCompanyExport(companyId: string, requestedBy: string): Promise<{ zip: Uint8Array; summary: Record<string, number> }> {
  const files: Record<string, Uint8Array> = {};
  const summary: Record<string, number> = {};
  const skipped: string[] = [];

  const put = (name: string, rows: Array<Record<string, unknown>>) => {
    files[`${name}.csv`] = strToU8(toCsv(rows));
    summary[name] = rows.length;
  };

  const company = rowsOf(await db.execute(sql`select * from companies where id = ${companyId}`));
  put("empresa", company);

  put("usuarios", rowsOf(await db.execute(sql`
    select u.name as nome, u.email, u.phone as telefone, cu.role_code as perfil, cu.status as situacao,
           u.last_login_at as ultimo_acesso, u.created_at as criado_em
    from company_users cu join users u on u.id = cu.user_id where cu.company_id = ${companyId} order by u.name`)));
  put("solicitacoes_de_usuario", rowsOf(await db.execute(sql`
    select name as nome, email, phone as telefone, role_code as perfil, status as situacao,
           requested_by_name as solicitado_por, decided_by_name as decidido_por, created_at as criado_em, decided_at as decidido_em
    from user_requests where company_id = ${companyId} order by created_at`)));

  for (const t of TABLES) {
    try {
      const where = t.where ?? "company_id = $1";
      const query = `select * from ${t.table} where ${where}`;
      const res = await db.execute(sql.raw(query.replace(/\$1/g, `'${companyId.replace(/[^0-9a-f-]/gi, "")}'`)));
      put(t.table, rowsOf(res));
    } catch {
      skipped.push(t.table);
    }
  }

  const readme = [
    "Exportação completa de dados - Mercato",
    `Empresa: ${String(company[0]?.trade_name ?? company[0]?.tradeName ?? "")}`,
    `Gerada em: ${new Date().toISOString()} por ${requestedBy}`,
    "",
    "Cada arquivo .csv abre no Excel (UTF-8, separador ponto e vírgula).",
    "Senhas, hashes e dados secretos não fazem parte da exportação.",
    "",
    "Tabelas e quantidade de linhas:",
    ...Object.entries(summary).map(([k, v]) => `- ${k}: ${v}`),
    ...(skipped.length ? ["", `Tabelas não exportadas: ${skipped.join(", ")}`] : []),
  ].join("\r\n");
  files["LEIA-ME.txt"] = strToU8(readme);

  return { zip: zipSync(files, { level: 6 }), summary };
}
