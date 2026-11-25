import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, companies, establishments, users, companyUsers, userRequests } from "@/db";
import { approveRequest, getSeats } from "@/lib/team";

const tag = Math.random().toString(36).slice(2, 8);
let companyId = "";
let adminId = "";
const decider = () => ({ id: adminId, name: "ADM" });

async function addRequest(email: string) {
  const [r] = await db
    .insert(userRequests)
    .values({ companyId, name: `Colab ${email}`, email, roleCode: "cashier", recoveryHash: "ab".repeat(32) })
    .returning();
  return r.id;
}

describe("solicitação e autorização de usuários", () => {
  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ name: "Admin", email: `adm-${tag}@teste.dev`, passwordHash: "x", status: "active" })
      .returning();
    adminId = u.id;
    const [c] = await db
      .insert(companies)
      .values({
        legalName: `Mercado ${tag}`, tradeName: `Mercado ${tag}`, cnpj: `99${tag}`.slice(0, 18),
        status: "active", licenseStatus: "active", maxUsers: 2,
      })
      .returning();
    companyId = c.id;
    const [e] = await db
      .insert(establishments)
      .values({ companyId, name: "Matriz", code: "001", isDefault: true, status: "active" })
      .returning();
    await db.insert(companyUsers).values({
      companyId, userId: adminId, defaultEstablishmentId: e.id, roleCode: "admin", status: "active",
    });
  });

  afterAll(async () => {
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.email, `adm-${tag}@teste.dev`));
    await db.delete(users).where(eq(users.email, `a-${tag}@teste.dev`));
    await db.delete(users).where(eq(users.email, `b-${tag}@teste.dev`));
  });

  it("conta usuários ativos e pendentes contra o limite", async () => {
    const s = await getSeats(companyId);
    expect(s).toMatchObject({ max: 2, active: 1, pending: 0, free: 1, mode: "platform" });
  });

  it("aprova dentro do limite, cria usuário com senha provisória e bloqueia acima dele", async () => {
    const idA = await addRequest(`a-${tag}@teste.dev`);
    const idB = await addRequest(`b-${tag}@teste.dev`);
    expect((await getSeats(companyId)).pending).toBe(2);

    const a = await approveRequest(companyId, idA, decider());
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.tempPassword).toHaveLength(12);
      const [m] = await db.select().from(companyUsers).where(eq(companyUsers.userId, a.userId));
      expect(m.companyId).toBe(companyId);
      expect(m.roleCode).toBe("cashier");
      const [u] = await db.select().from(users).where(eq(users.id, a.userId));
      expect(u.mustChangePassword).toBe(true);
      expect(u.recoveryHash).toBe("ab".repeat(32));
    }

    const b = await approveRequest(companyId, idB, decider());
    expect(b).toMatchObject({ ok: false, status: 409 });
    if (!b.ok) expect(b.error).toMatch(/Limite de usuários/);

    // aprovar de novo a mesma solicitação é recusado
    const again = await approveRequest(companyId, idA, decider());
    expect(again).toMatchObject({ ok: false, status: 409 });
  });

  it("não aprova solicitação de outra empresa", async () => {
    const id = await addRequest(`c-${tag}@teste.dev`);
    const r = await approveRequest("00000000-0000-0000-0000-000000000000", id, decider());
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});
