// Rótulos e formatação dos relatórios (pt-BR). O servidor devolve linhas com
// chaves técnicas; aqui elas viram colunas legíveis, com totais coerentes.

export type ColumnKind = "text" | "money" | "number" | "percent" | "date" | "datetime";

interface ColumnSpec {
  label: string;
  kind: ColumnKind;
  /** Entra na linha de totais. */
  sum?: boolean;
}

const COLUMNS: Record<string, ColumnSpec> = {
  saleNumber: { label: "Nº da venda", kind: "text" },
  orderNumber: { label: "Pedido", kind: "text" },
  date: { label: "Data", kind: "datetime" },
  createdAt: { label: "Data", kind: "datetime" },
  openedAt: { label: "Abertura", kind: "datetime" },
  closedAt: { label: "Fechamento", kind: "datetime" },
  dueDate: { label: "Vencimento", kind: "date" },
  customer: { label: "Cliente", kind: "text" },
  operator: { label: "Operador", kind: "text" },
  supplier: { label: "Fornecedor", kind: "text" },
  method: { label: "Forma de pagamento", kind: "text" },
  category: { label: "Categoria", kind: "text" },
  categoryName: { label: "Categoria", kind: "text" },
  code: { label: "Código", kind: "text" },
  sku: { label: "Código", kind: "text" },
  name: { label: "Nome", kind: "text" },
  product: { label: "Produto", kind: "text" },
  unit: { label: "Un.", kind: "text" },
  description: { label: "Descrição", kind: "text" },
  type: { label: "Tipo", kind: "text" },
  status: { label: "Situação", kind: "text" },
  user: { label: "Usuário", kind: "text" },
  originDocument: { label: "Documento", kind: "text" },
  subtotal: { label: "Subtotal", kind: "money", sum: true },
  discount: { label: "Desconto", kind: "money", sum: true },
  total: { label: "Total", kind: "money", sum: true },
  revenue: { label: "Receita", kind: "money", sum: true },
  cost: { label: "Custo", kind: "money", sum: true },
  grossProfit: { label: "Lucro bruto", kind: "money", sum: true },
  marginPercent: { label: "Margem", kind: "percent" },
  avgTicket: { label: "Ticket médio", kind: "money" },
  amount: { label: "Valor", kind: "money", sum: true },
  paidAmount: { label: "Pago", kind: "money", sum: true },
  paid: { label: "Pago", kind: "money", sum: true },
  salePrice: { label: "Preço de venda", kind: "money" },
  costPrice: { label: "Preço de custo", kind: "money" },
  stockSaleValue: { label: "Estoque a preço de venda", kind: "money", sum: true },
  stockCostValue: { label: "Estoque a custo", kind: "money", sum: true },
  quantity: { label: "Quantidade", kind: "number", sum: true },
  count: { label: "Qtd. de vendas", kind: "number", sum: true },
  salesCount: { label: "Qtd. de vendas", kind: "number", sum: true },
  minStock: { label: "Estoque mínimo", kind: "number" },
  previousBalance: { label: "Saldo anterior", kind: "number" },
  newBalance: { label: "Novo saldo", kind: "number" },
  percent: { label: "% da receita", kind: "percent" },
};

const VALUES: Record<string, string> = {
  open: "Em aberto",
  partial: "Parcial",
  paid: "Quitado",
  overdue: "Vencido",
  cancelled: "Cancelado",
  payable: "A pagar",
  receivable: "A receber",
  draft: "Rascunho",
  pending_approval: "Aguard. aprovação",
  approved: "Aprovado",
  sent: "Enviado",
  partially_received: "Recebido parcial",
  received: "Recebido",
  counting: "Em contagem",
  closed: "Encerrado",
  completed: "Concluído",
  purchase_in: "Entrada por compra",
  manual_in: "Entrada manual",
  sale_out: "Saída por venda",
  manual_out: "Saída manual",
  return_in: "Devolução",
  sale_in: "Retorno de venda cancelada",
  refund_out: "Saída por estorno",
  adjustment_pos: "Ajuste positivo",
  adjustment_neg: "Ajuste negativo",
  inventory: "Inventário",
};

export function columnLabel(key: string): string {
  return COLUMNS[key]?.label ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export function columnKind(key: string): ColumnKind {
  return COLUMNS[key]?.kind ?? "text";
}

export function isSummable(key: string): boolean {
  return Boolean(COLUMNS[key]?.sum);
}

export function translateValue(value: unknown): string {
  const s = String(value ?? "");
  return VALUES[s] ?? s;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function formatCell(key: string, value: unknown, tz = "America/Manaus"): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (columnKind(key)) {
    case "money":
      return brl.format(Number(value));
    case "number":
      return num.format(Number(value));
    case "percent":
      return `${Number(value).toFixed(1).replace(".", ",")}%`;
    case "date": {
      const s = String(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : s;
    }
    case "datetime": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(d);
    }
    default:
      return translateValue(value);
  }
}

/** Soma as colunas que fazem sentido somar; devolve só as que existem. */
export function computeTotals(
  keys: string[],
  rows: Array<Record<string, unknown>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (!isSummable(k)) continue;
    out[k] = Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 1000) / 1000;
  }
  return out;
}

/** Chaves internas (começam com "_") não aparecem como coluna. */
export function visibleKeys(rows: Array<Record<string, unknown>>): string[] {
  return rows.length > 0 ? Object.keys(rows[0]).filter((k) => !k.startsWith("_")) : [];
}
