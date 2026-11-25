import { and, eq, sql } from "drizzle-orm";
import { db, companies, companyUsers, userRequests, users, establishments } from "@/db";
import { hashPassword } from "@/lib/auth";
import { generateTempPassword } from "@/lib/security";

type Executor = typeof db;
export const ROLE_CODES = ["admin", "manager", "cashier", "stockist"] as const;

/** Vagas: usuários ativos + solicitações pendentes contra o limite definido pelo ADM da plataforma. */
export async function getSeats(companyId: string, ex: Executor = db) {
  const [c] = await ex
    .select({ maxUsers: companies.maxUsers, mode: companies.userApprovalMode })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const [a] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.status, "active")));
  const [p] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(userRequests)
    .where(and(eq(userRequests.companyId, companyId), eq(userRequests.status, "pending")));
  const max = c?.maxUsers ?? 0;
  return {
    max,
    mode: (c?.mode ?? "platform") as "platform" | "company",
    active: a?.n ?? 0,
    pending: p?.n ?? 0,
    free: Math.max(0, max - (a?.n ?? 0)),
  };
}

export type ApproveResult =
  | { ok: true; userId: string; email: string; tempPassword: string }
  | { ok: false; status: number; error: string };

/** Aprova uma solicitação: valida limite, cria o usuário com senha temporária e vincula à empresa. */
export async function approveRequest(
  companyId: string,
  requestId: string,
  decider: { id: string; name: string }
): Promise<ApproveResult> {
  return db.transaction(async (tx) => {
    // trava a empresa para que duas aprovações simultâneas não estourem o limite
    await tx.execute(sql`select id from companies where id = ${companyId} for update`);
    const [req] = await tx
      .select()
      .from(userRequests)
      .where(and(eq(userRequests.id, requestId), eq(userRequests.companyId, companyId)))
      .limit(1);
    if (!req) return { ok: false as const, status: 404, error: "Solicitação não encontrada." };
    if (req.status !== "pending")
      return { ok: false as const, status: 409, error: "Esta solicitação já foi decidida." };

    const seats = await getSeats(companyId, tx as unknown as Executor);
    if (seats.active >= seats.max) {
      return {
        ok: false as const,
        status: 409,
        error: `Limite de usuários atingido (${seats.active}/${seats.max}). Peça ao administrador da plataforma para aumentar o limite.`,
      };
    }

    const email = req.email.toLowerCase();
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing)
      return { ok: false as const, status: 409, error: "Já existe um usuário com este e-mail no sistema." };

    const [est] = await tx
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.companyId, companyId), eq(establishments.isDefault, true)))
      .limit(1);

    const tempPassword = generateTempPassword();
    const [user] = await tx
      .insert(users)
      .values({
        name: req.name,
        email,
        phone: req.phone,
        passwordHash: hashPassword(tempPassword),
        status: "active",
      })
      .returning();
    await tx.insert(companyUsers).values({
      companyId,
      userId: user.id,
      defaultEstablishmentId: est?.id ?? null,
      roleCode: req.roleCode,
      maxDiscountPercent: req.roleCode === "admin" ? "100.00" : "5.00",
      status: "active",
    });
    await tx
      .update(userRequests)
      .set({
        status: "approved",
        decidedBy: decider.id,
        decidedByName: decider.name,
        decidedAt: new Date(),
        createdUserId: user.id,
      })
      .where(eq(userRequests.id, req.id));
    return { ok: true as const, userId: user.id, email, tempPassword };
  });
}

export interface TeamSalesRow {
  userId: string;
  name: string;
  email: string;
  roleCode: string;
  status: string;
  salesCount: number;
  total: number;
  avgTicket: number;
  cancelledCount: number;
  lastSaleAt: string | null;
}

/** Vendas por colaborador da empresa no período (inclui quem ainda não vendeu). */
export async function getTeamSales(companyId: string, from: Date, to: Date): Promise<TeamSalesRow[]> {
  const rows = await db.execute(sql`
    select u.id as "userId", u.name, u.email, cu.role_code as "roleCode", cu.status,
      count(s.id) filter (where s.status = 'completed')::int as "salesCount",
      coalesce(sum(s.total) filter (where s.status = 'completed'), 0)::float8 as total,
      count(s.id) filter (where s.status = 'cancelled')::int as "cancelledCount",
      max(s.created_at) filter (where s.status = 'completed') as "lastSaleAt"
    from company_users cu
    join users u on u.id = cu.user_id
    left join sales s on s.operator_id = u.id and s.company_id = cu.company_id
      and s.created_at >= ${from.toISOString()} and s.created_at <= ${to.toISOString()}
    where cu.company_id = ${companyId}
    group by u.id, u.name, u.email, cu.role_code, cu.status
    order by total desc, u.name`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Array<
    Omit<TeamSalesRow, "avgTicket" | "lastSaleAt"> & { lastSaleAt: Date | string | null }
  >;
  return list.map((r) => ({
    ...r,
    total: Number(r.total),
    avgTicket: r.salesCount > 0 ? Number(r.total) / r.salesCount : 0,
    lastSaleAt: r.lastSaleAt ? new Date(r.lastSaleAt).toISOString() : null,
  }));
}
