export type RoleCode = "admin" | "manager" | "cashier" | "stockist";

export const ALL_PERMISSIONS = [
  { code: "products.read", module: "Produtos", label: "Consultar produtos" },
  { code: "products.create", module: "Produtos", label: "Cadastrar produtos" },
  { code: "products.update", module: "Produtos", label: "Editar produtos e preços" },
  { code: "products.delete", module: "Produtos", label: "Inativar/excluir produtos" },
  { code: "products.view_cost", module: "Produtos", label: "Visualizar preço de custo e margem" },
  { code: "stock.read", module: "Estoque", label: "Consultar saldos e movimentações" },
  { code: "stock.move", module: "Estoque", label: "Realizar entradas, saídas e ajustes" },
  { code: "stock.inventory", module: "Estoque", label: "Abrir e aprovar inventários" },
  { code: "sales.read", module: "Vendas & PDV", label: "Consultar vendas e cupons" },
  { code: "sales.create", module: "Vendas & PDV", label: "Realizar vendas no PDV" },
  { code: "sales.cancel", module: "Vendas & PDV", label: "Cancelar vendas e registrar devoluções" },
  { code: "sales.discount", module: "Vendas & PDV", label: "Conceder descontos" },
  { code: "cash.open", module: "Caixa", label: "Abrir caixa" },
  { code: "cash.close", module: "Caixa", label: "Fechar caixa" },
  { code: "cash.move", module: "Caixa", label: "Realizar suprimento e sangria" },
  { code: "purchases.read", module: "Compras", label: "Consultar fornecedores e pedidos" },
  { code: "purchases.manage", module: "Compras", label: "Gerenciar pedidos e recebimentos" },
  { code: "customers.read", module: "Clientes", label: "Consultar clientes" },
  { code: "customers.manage", module: "Clientes", label: "Cadastrar e editar clientes" },
  { code: "finance.read", module: "Financeiro", label: "Consultar contas e fluxo de caixa" },
  { code: "finance.manage", module: "Financeiro", label: "Lançar, baixar e estornar títulos" },
  { code: "reports.read", module: "Relatórios", label: "Visualizar dashboard e relatórios" },
  { code: "reports.export", module: "Relatórios", label: "Exportar relatórios CSV/Excel" },
  { code: "users.manage", module: "Administração", label: "Gerenciar usuários, convites e perfis" },
  { code: "companies.manage", module: "Administração", label: "Gerenciar empresas e estabelecimentos" },
  { code: "settings.manage", module: "Administração", label: "Alterar configurações do sistema" },
  { code: "audit.read", module: "Administração", label: "Consultar trilha de auditoria" },
] as const;

export type PermissionCode = (typeof ALL_PERMISSIONS)[number]["code"];

export const ROLE_DEFINITIONS: Record<
  RoleCode,
  { name: string; description: string; permissions: PermissionCode[] }
> = {
  admin: {
    name: "Administrador",
    description:
      "Acesso total à empresa, estabelecimentos, usuários, financeiro, configurações e auditoria.",
    permissions: ALL_PERMISSIONS.map((p) => p.code),
  },
  manager: {
    name: "Gerente",
    description:
      "Gerencia operação diária, produtos, estoque, compras, vendas, relatórios e financeiro operacional.",
    permissions: [
      "products.read",
      "products.create",
      "products.update",
      "products.delete",
      "products.view_cost",
      "stock.read",
      "stock.move",
      "stock.inventory",
      "sales.read",
      "sales.create",
      "sales.cancel",
      "sales.discount",
      "cash.open",
      "cash.close",
      "cash.move",
      "purchases.read",
      "purchases.manage",
      "customers.read",
      "customers.manage",
      "finance.read",
      "finance.manage",
      "reports.read",
      "reports.export",
    ],
  },
  cashier: {
    name: "Operador de Caixa",
    description:
      "Opera PDV, abertura/fechamento de caixa, vendas e consulta de clientes. Sem acesso a custo ou financeiro.",
    permissions: [
      "products.read",
      "stock.read",
      "sales.read",
      "sales.create",
      "sales.discount",
      "cash.open",
      "cash.close",
      "cash.move",
      "customers.read",
      "customers.manage",
    ],
  },
  stockist: {
    name: "Estoquista",
    description:
      "Gerencia catálogo de produtos, movimentações de estoque, inventários e recebimento de compras.",
    permissions: [
      "products.read",
      "products.create",
      "products.update",
      "stock.read",
      "stock.move",
      "stock.inventory",
      "purchases.read",
      "purchases.manage",
    ],
  },
};

export function resolvePermissions(
  roleCode: string,
  customPermissions?: { granted?: string[]; revoked?: string[] } | null
): Set<PermissionCode> {
  const base =
    ROLE_DEFINITIONS[(roleCode as RoleCode) ?? "cashier"]?.permissions ?? [];
  const set = new Set<PermissionCode>(base);

  if (customPermissions?.granted) {
    for (const code of customPermissions.granted) {
      set.add(code as PermissionCode);
    }
  }
  if (customPermissions?.revoked) {
    for (const code of customPermissions.revoked) {
      set.delete(code as PermissionCode);
    }
  }

  // Hard security guardrail: cashier never sees cost price unless explicitly elevated to another role
  if (roleCode === "cashier" && !customPermissions?.granted?.includes("products.view_cost")) {
    set.delete("products.view_cost");
  }

  return set;
}

export function hasPermission(
  permissions: Set<PermissionCode> | PermissionCode[],
  code: PermissionCode
): boolean {
  if (Array.isArray(permissions)) {
    return permissions.includes(code);
  }
  return permissions.has(code);
}
