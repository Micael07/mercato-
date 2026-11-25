// Datas no fuso do negócio. O servidor roda em UTC, então "hoje", "vencido" e os
// limites de um período precisam ser calculados no fuso da loja, não em UTC.
// Troque com a variável BUSINESS_TIMEZONE (padrão: America/Manaus).

export const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE || "America/Manaus";

/** Data (AAAA-MM-DD) de um instante no fuso informado. */
export function dateInTz(date: Date, tz: string = BUSINESS_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayInTz(tz: string = BUSINESS_TZ, now: Date = new Date()): string {
  return dateInTz(now, tz);
}

/** Diferença do fuso para UTC em minutos (positivo a leste de Greenwich). */
export function tzOffsetMinutes(at: Date, tz: string = BUSINESS_TZ): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Instante UTC em que o dia (AAAA-MM-DD) começa no fuso. */
export function startOfDayUtc(dateStr: string, tz: string = BUSINESS_TZ): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  const second = guess - tzOffsetMinutes(new Date(first), tz) * 60000;
  return new Date(second);
}

/** Último milissegundo do dia (AAAA-MM-DD) no fuso. */
export function endOfDayUtc(dateStr: string, tz: string = BUSINESS_TZ): Date {
  return new Date(startOfDayUtc(addDaysStr(dateStr, 1), tz).getTime() - 1);
}

export function isDateStr(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
