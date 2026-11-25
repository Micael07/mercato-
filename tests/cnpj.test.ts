import { describe, expect, it } from "vitest";
import { isValidCnpj, lookupCnpj, normalizeBrasilApi } from "@/lib/cnpj";

const OK = "00000000000191"; // CNPJ de teste válido (Banco do Brasil)

function fakeFetch(map: Record<string, { status: number; body?: unknown } | "throw">) {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    const r = key ? map[key] : { status: 500 };
    if (r === "throw") throw new Error("network");
    return { status: r.status, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
}

describe("cnpj", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCnpj("00.000.000/0001-91")).toBe(true);
    expect(isValidCnpj("00.000.000/0001-92")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });

  it("rejeita CNPJ inválido sem chamar a rede", async () => {
    let called = false;
    const f = (async () => {
      called = true;
      return { status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const r = await lookupCnpj("12345678000100", { fetcher: f });
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(called).toBe(false);
  });

  it("usa a BrasilAPI e normaliza os campos", async () => {
    const f = fakeFetch({
      "brasilapi.com.br": {
        status: 200,
        body: {
          razao_social: "DISTRIBUIDORA EXEMPLO LTDA",
          nome_fantasia: "EXEMPLO ATACADO",
          descricao_tipo_de_logradouro: "RUA",
          logradouro: "DAS FLORES",
          numero: "120",
          complemento: "SALA 2",
          bairro: "CENTRO",
          cep: "69000000",
          municipio: "MANAUS",
          uf: "AM",
          ddd_telefone_1: "9232345678",
          email: "VENDAS@EXEMPLO.COM.BR",
          descricao_situacao_cadastral: "ATIVA",
        },
      },
    });
    const r = await lookupCnpj(OK, { fetcher: f });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.legalName).toBe("DISTRIBUIDORA EXEMPLO LTDA");
      expect(r.data.tradeName).toBe("EXEMPLO ATACADO");
      expect(r.data.address).toBe("Rua das Flores, 120, SALA 2, Centro");
      expect(r.data.city).toBe("Manaus");
      expect(r.data.state).toBe("AM");
      expect(r.data.zipCode).toBe("69000000");
      expect(r.data.email).toBe("vendas@exemplo.com.br");
      expect(r.data.active).toBe(true);
    }
  });

  it("cai para a segunda fonte quando a primeira falha", async () => {
    const f = fakeFetch({
      "brasilapi.com.br": "throw",
      "publica.cnpj.ws": {
        status: 200,
        body: {
          razao_social: "MERCEARIA SUL LTDA",
          estabelecimento: {
            nome_fantasia: null,
            tipo_logradouro: "AVENIDA",
            logradouro: "BRASIL",
            numero: "10",
            bairro: "CENTRO",
            cep: "69000-000",
            cidade: { nome: "Manaus" },
            estado: { sigla: "AM" },
            situacao_cadastral: "Baixada",
            ddd1: "92",
            telefone1: "33334444",
          },
        },
      },
    });
    const r = await lookupCnpj(OK, { fetcher: f });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.source).toBe("cnpjws");
      expect(r.data.tradeName).toBe("MERCEARIA SUL LTDA");
      expect(r.data.active).toBe(false);
      expect(r.data.phone).toBe("9233334444");
    }
  });

  it("informa não encontrado e indisponível", async () => {
    expect(
      await lookupCnpj(OK, {
        fetcher: fakeFetch({ "brasilapi.com.br": { status: 404 }, "publica.cnpj.ws": { status: 404 } }),
      })
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await lookupCnpj(OK, { fetcher: fakeFetch({ "brasilapi.com.br": "throw", "publica.cnpj.ws": "throw" }) })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("normalizeBrasilApi aceita situação vazia como ativa", () => {
    expect(normalizeBrasilApi(OK, { razao_social: "X" }).active).toBe(true);
  });
});
