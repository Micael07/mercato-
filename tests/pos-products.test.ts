import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), select: vi.fn(), query: { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireApiAuth: mocks.auth }));
vi.mock("@/db", async (original) => ({ ...await original<typeof import("@/db")>(), db: { select: mocks.select } }));
const ctx = { company: { id: "00000000-0000-4000-8000-000000000001" }, establishment: { id: "00000000-0000-4000-8000-000000000002" }, permissions: new Set(["products.view_cost", "sales.create"]) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ctx });
  mocks.select.mockReturnValue(mocks.query);
  for (const key of ["from", "leftJoin", "where", "orderBy", "limit"] as const) mocks.query[key].mockReturnValue(mocks.query);
  mocks.query.offset.mockResolvedValue([]);
});

describe("Projeção segura de produtos do PDV", () => {
  it("seleciona dados de venda sem custo nem margem, mesmo para admin", async () => {
    const { GET } = await import("@/app/api/pos/products/route");
    const response = await GET(new Request("http://localhost/api/pos/products?q=produto"));
    expect(response.status).toBe(200);
    const fields = Object.keys(mocks.select.mock.calls[0][0]);
    expect(fields).toContain("salePrice");
    expect(fields).not.toContain("costPrice");
    expect(fields).not.toContain("marginPercent");
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "sales.create");
    const where = new PgDialect().sqlToQuery(mocks.query.where.mock.calls[0][0]);
    expect(where.params).toContain(ctx.company.id);
    const join = new PgDialect().sqlToQuery(mocks.query.leftJoin.mock.calls[0][1]);
    expect(join.params).toContain(ctx.company.id);
    expect(join.params).toContain(ctx.establishment.id);
  });
  it("não consulta o banco para usuário sem permissão", async () => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) });
    const { GET } = await import("@/app/api/pos/products/route");
    expect((await GET(new Request("http://localhost/api/pos/products"))).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("valida paginação e identificadores recebidos", async () => {
    const { GET } = await import("@/app/api/pos/products/route");
    for (const query of ["offset=-1", "limit=NaN", "limit=101", "ids=invalid", "ids="]) {
      expect((await GET(new Request(`http://localhost/api/pos/products?${query}`))).status).toBe(400);
    }
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("retorna preços e saldos numéricos com paginação real", async () => {
    const row = { id: "product", internalCode: "1", sku: "SKU", barcode: null, name: "Teste", unit: "UN", salePrice: "10.50", currentStock: "3.000", allowFractional: false, trackStock: true, status: "active", categoryName: "Geral" };
    mocks.query.offset.mockResolvedValue([row, { ...row, id: "next" }]);
    const { GET } = await import("@/app/api/pos/products/route");
    const response = await GET(new Request("http://localhost/api/pos/products?limit=1"));
    const result = await response.json();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].salePrice).toBe(10.5);
    expect(result.items[0].currentStock).toBe(3);
    expect(result.hasMore).toBe(true);
  });
});
