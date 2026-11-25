import crypto from "node:crypto";

/** Minúsculas, sem acentos e com espaços simples: "  JOÃO  da Silva" → "joao da silva". */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidCpf(value: unknown): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/** Aceita AAAA-MM-DD ou DD/MM/AAAA e devolve AAAA-MM-DD válido (ou null). */
export function parseBirthDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const now = new Date();
  if (dt > now || y < 1900) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET não configurado.");
  return s;
}

export type RecoveryInput = { cpf: unknown; fullName: unknown; birthDate: unknown };

/** HMAC dos três dados. Retorna null se algum for inválido. */
export function computeRecoveryHash(input: RecoveryInput): string | null {
  const cpf = onlyDigits(input.cpf);
  const name = normalizeName(input.fullName);
  const birth = parseBirthDate(input.birthDate);
  if (!isValidCpf(cpf) || name.split(" ").length < 2 || !birth) return null;
  return crypto.createHmac("sha256", secret()).update(`recovery|${cpf}|${name}|${birth}`).digest("hex");
}

export function recoveryMatches(stored: string | null | undefined, candidate: string | null): boolean {
  if (!stored || !candidate) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_LOCK_MINUTES = 30;

// --- Cadastro (CPF e nascimento) criptografado, legível apenas pelo ADM da plataforma ---

function profileKey(): Buffer {
  return crypto.createHash("sha256").update(`profile-key|${secret()}`).digest();
}

export interface UserProfile { cpf: string; birthDate: string }

/** Criptografa CPF (só dígitos) e nascimento (AAAA-MM-DD). Retorna null se inválidos. */
export function encryptProfile(input: { cpf: unknown; birthDate: unknown }): string | null {
  const cpf = onlyDigits(input.cpf);
  const birthDate = parseBirthDate(input.birthDate);
  if (!isValidCpf(cpf) || !birthDate) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", profileKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ cpf, birthDate }), "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(".");
}

export function decryptProfile(stored: string | null | undefined): UserProfile | null {
  if (!stored) return null;
  try {
    const [iv, tag, data] = stored.split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", profileKey(), Buffer.from(iv, "hex"));
    d.setAuthTag(Buffer.from(tag, "hex"));
    const json = Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
    const p = JSON.parse(json);
    return typeof p.cpf === "string" && typeof p.birthDate === "string" ? p : null;
  } catch {
    return null; // AUTH_SECRET trocado ou dado corrompido
  }
}

export function formatCpf(cpf: string): string {
  const d = onlyDigits(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}
