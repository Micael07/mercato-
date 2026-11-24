import { describe, it, expect } from "vitest";
import { evaluateLicense, extendExpiry, licenseBlockedMessage } from "../src/lib/license";
import { generateTempPassword, validatePasswordStrength } from "../src/lib/security";
import { isPlatformAdminEmail } from "../src/lib/platform";

const now = new Date("2026-11-23T12:00:00Z");
const day = 86_400_000;

describe("licenciamento", () => {
  it("avalia situação da licença", () => {
    expect(evaluateLicense("pending", null, now).state).toBe("pending");
    expect(evaluateLicense("suspended", new Date(now.getTime() + 30 * day), now).state).toBe("suspended");
    expect(evaluateLicense("active", null, now).state).toBe("ok");
    expect(evaluateLicense("active", new Date(now.getTime() + 30 * day), now).state).toBe("ok");
    expect(evaluateLicense("trial", new Date(now.getTime() + 3 * day), now)).toEqual({ state: "expiring", daysLeft: 3 });
    expect(evaluateLicense("active", new Date(now.getTime() - 1000), now).state).toBe("expired");
  });

  it("renova somando ao vencimento atual ou a partir de hoje se já venceu", () => {
    const future = new Date(now.getTime() + 10 * day);
    expect(extendExpiry(future, 30, now).getTime()).toBe(future.getTime() + 30 * day);
    const past = new Date(now.getTime() - 10 * day);
    expect(extendExpiry(past, 30, now).getTime()).toBe(now.getTime() + 30 * day);
    expect(extendExpiry(null, 30, now).getTime()).toBe(now.getTime() + 30 * day);
  });

  it("gera senha provisória válida pela regra do sistema", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTempPassword();
      expect(password).toHaveLength(12);
      expect(validatePasswordStrength(password).valid).toBe(true);
    }
  });

  it("reconhece o administrador da plataforma só pelo e-mail configurado", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Dono@Exemplo.com, outro@exemplo.com";
    expect(isPlatformAdminEmail("dono@exemplo.com")).toBe(true);
    expect(isPlatformAdminEmail("cliente@exemplo.com")).toBe(false);
    expect(isPlatformAdminEmail(null)).toBe(false);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdminEmail("dono@exemplo.com")).toBe(false);
  });

  it("mensagens de bloqueio orientam o cliente", () => {
    expect(licenseBlockedMessage("pending")).toContain("não foi liberado");
    expect(licenseBlockedMessage("expired")).toContain("venceu");
    expect(licenseBlockedMessage("suspended")).toContain("bloqueado");
  });
});
