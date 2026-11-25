import { describe, expect, it } from "vitest";
import { addDaysStr, dateInTz, endOfDayUtc, startOfDayUtc, todayInTz } from "@/lib/dates";

describe("datas no fuso do negócio", () => {
  it("hoje à noite em Manaus ainda é o mesmo dia (não vira o dia UTC)", () => {
    // 24/11 23:30 em Manaus = 25/11 03:30 UTC
    const now = new Date("2026-11-25T03:30:00Z");
    expect(todayInTz("America/Manaus", now)).toBe("2026-11-24");
    expect(dateInTz(now, "UTC")).toBe("2026-11-25");
  });

  it("limites do dia em Manaus (UTC-4)", () => {
    expect(startOfDayUtc("2026-11-24", "America/Manaus").toISOString()).toBe("2026-11-24T04:00:00.000Z");
    expect(endOfDayUtc("2026-11-24", "America/Manaus").toISOString()).toBe("2026-11-25T03:59:59.999Z");
  });

  it("limites do dia em São Paulo (UTC-3)", () => {
    expect(startOfDayUtc("2026-11-24", "America/Sao_Paulo").toISOString()).toBe("2026-11-24T03:00:00.000Z");
  });

  it("soma dias entre meses", () => {
    expect(addDaysStr("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysStr("2026-03-01", -1)).toBe("2026-02-28");
  });
});
