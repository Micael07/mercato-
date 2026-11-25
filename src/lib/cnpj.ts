// Consulta de CNPJ em fontes públicas (BrasilAPI e, se falhar, publica.cnpj.ws).
// Executa apenas no servidor: o navegador nunca chama essas APIs diretamente.

export interface CnpjLookup {
  document: string;
  legalName: string;
  tradeName: string;
  phone: string;
  email: string;
  address: string;
  zipCode: string;
  city: string;
  state: string;
  situation: string;
  active: boolean;
  source: "brasilapi" | "cnpjws";
}

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Valida os dígitos verificadores do CNPJ. */
export function isValidCnpj(value: unknown): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    let factor = base.length - 7;
    let sum = 0;
    for (const ch of base) {
      sum += Number(ch) * factor--;
      if (factor < 2) factor = 9;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

const clean = (v: unknown) => String(v ?? "").trim();

function titleCase(value: string): string {
  const small = new Set(["de", "da", "do", "das", "dos", "e"]);
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function joinAddress(parts: Array<unknown>): string {
  return parts.map(clean).filter(Boolean).join(", ");
}

export function normalizeBrasilApi(cnpj: string, d: Record<string, unknown>): CnpjLookup {
  const situation = clean(d.descricao_situacao_cadastral);
  const type = clean(d.descricao_tipo_de_logradouro);
  const street = [type, clean(d.logradouro)].filter(Boolean).join(" ");
  const phone = clean(d.ddd_telefone_1) || clean(d.ddd_telefone_2);
  return {
    document: cnpj,
    legalName: clean(d.razao_social),
    tradeName: clean(d.nome_fantasia) || clean(d.razao_social),
    phone,
    email: clean(d.email).toLowerCase(),
    address: joinAddress([titleCase(street), d.numero, d.complemento, titleCase(clean(d.bairro))]),
    zipCode: onlyDigits(d.cep),
    city: titleCase(clean(d.municipio)),
    state: clean(d.uf).toUpperCase().slice(0, 2),
    situation,
    active: situation === "" ? true : situation.toUpperCase() === "ATIVA",
    source: "brasilapi",
  };
}

export function normalizeCnpjWs(cnpj: string, d: Record<string, unknown>): CnpjLookup {
  const est = (d.estabelecimento ?? {}) as Record<string, unknown>;
  const cidade = (est.cidade ?? {}) as Record<string, unknown>;
  const estado = (est.estado ?? {}) as Record<string, unknown>;
  const situation = clean(est.situacao_cadastral);
  const phone = est.ddd1 || est.telefone1 ? `${clean(est.ddd1)}${clean(est.telefone1)}` : "";
  const street = [clean(est.tipo_logradouro), clean(est.logradouro)].filter(Boolean).join(" ");
  return {
    document: cnpj,
    legalName: clean(d.razao_social),
    tradeName: clean(est.nome_fantasia) || clean(d.razao_social),
    phone,
    email: clean(est.email).toLowerCase(),
    address: joinAddress([titleCase(street), est.numero, est.complemento, titleCase(clean(est.bairro))]),
    zipCode: onlyDigits(est.cep),
    city: clean(cidade.nome),
    state: clean(estado.sigla).toUpperCase().slice(0, 2),
    situation,
    active: situation === "" ? true : situation.toUpperCase() === "ATIVA",
    source: "cnpjws",
  };
}

async function getJson(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "MercatoERP/1.0" },
      cache: "no-store",
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export type CnpjResult =
  | { ok: true; data: CnpjLookup }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

export async function lookupCnpj(
  value: unknown,
  opts: { fetcher?: typeof fetch; timeoutMs?: number } = {}
): Promise<CnpjResult> {
  const cnpj = onlyDigits(value);
  if (!isValidCnpj(cnpj)) return { ok: false, reason: "invalid" };
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  let notFound = false;
  try {
    const r = await getJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, fetcher, timeoutMs);
    if (r.status === 200 && r.body && clean(r.body.razao_social)) {
      return { ok: true, data: normalizeBrasilApi(cnpj, r.body) };
    }
    if (r.status === 404) notFound = true;
  } catch {
    /* tenta a próxima fonte */
  }

  try {
    const r = await getJson(`https://publica.cnpj.ws/cnpj/${cnpj}`, fetcher, timeoutMs);
    if (r.status === 200 && r.body && clean(r.body.razao_social)) {
      return { ok: true, data: normalizeCnpjWs(cnpj, r.body) };
    }
    if (r.status === 404 && notFound) return { ok: false, reason: "not_found" };
  } catch {
    /* indisponível */
  }

  return { ok: false, reason: notFound ? "not_found" : "unavailable" };
}
