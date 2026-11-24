import crypto from "node:crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof password !== "string" || password.length < 8) {
    return {
      valid: false,
      error: "A senha deve ter no mínimo 8 caracteres.",
    };
  }
  if (password.length > 128) {
    return {
      valid: false,
      error: "A senha deve ter no máximo 128 caracteres.",
    };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return {
      valid: false,
      error: "A senha deve conter letras maiúsculas e minúsculas.",
    };
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) {
    return {
      valid: false,
      error: "A senha deve conter ao menos um número ou caractere especial.",
    };
  }
  return { valid: true };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 180;
}

export function sanitizeText(value: unknown, maxLength = 250): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

/** Senha provisória legível (sem I, O, l, 0, 1), sempre válida pela regra de senha do sistema. */
export function generateTempPassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
