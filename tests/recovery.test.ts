import { describe, it, expect, beforeAll } from "vitest";
import { computeRecoveryHash, isValidCpf, normalizeName, parseBirthDate, recoveryMatches } from "../src/lib/recovery";

beforeAll(() => { process.env.AUTH_SECRET = process.env.AUTH_SECRET || "testsecret-testsecret-testsecret-12345"; });

describe("recuperação de senha sem e-mail", () => {
  it("normaliza nome sem diferenciar maiúscula, minúscula, acento ou espaços", () => {
    expect(normalizeName("  JOÃO   da Silva ")).toBe("joao da silva");
    expect(normalizeName("Maria de Nazaré")).toBe(normalizeName("maria DE nazare"));
  });

  it("valida CPF pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });

  it("aceita data em dois formatos e rejeita inválidas ou futuras", () => {
    expect(parseBirthDate("1990-05-17")).toBe("1990-05-17");
    expect(parseBirthDate("17/05/1990")).toBe("1990-05-17");
    expect(parseBirthDate("31/02/1990")).toBeNull();
    expect(parseBirthDate("2999-01-01")).toBeNull();
    expect(parseBirthDate("")).toBeNull();
  });

  it("gera o mesmo hash para as mesmas informações e diferente se algo muda", () => {
    const a = computeRecoveryHash({ cpf: "529.982.247-25", fullName: "João da Silva", birthDate: "1990-05-17" });
    const b = computeRecoveryHash({ cpf: "52998224725", fullName: "  JOAO DA SILVA", birthDate: "17/05/1990" });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(recoveryMatches(a, b)).toBe(true);
    expect(recoveryMatches(a, computeRecoveryHash({ cpf: "52998224725", fullName: "João da Silva", birthDate: "1990-05-18" }))).toBe(false);
    expect(recoveryMatches(a, computeRecoveryHash({ cpf: "52998224725", fullName: "Joana da Silva", birthDate: "1990-05-17" }))).toBe(false);
    expect(recoveryMatches(null, a)).toBe(false);
  });

  it("exige nome e sobrenome, CPF válido e data válida", () => {
    expect(computeRecoveryHash({ cpf: "52998224725", fullName: "João", birthDate: "1990-05-17" })).toBeNull();
    expect(computeRecoveryHash({ cpf: "11111111111", fullName: "João Silva", birthDate: "1990-05-17" })).toBeNull();
    expect(computeRecoveryHash({ cpf: "52998224725", fullName: "João Silva", birthDate: "x" })).toBeNull();
  });
});
