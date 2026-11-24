import {
  db,
  companySettings,
  paymentMethods,
  financialCategories,
  categories,
} from "@/db";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Dados iniciais de uma empresa nova (formas de pagamento, categorias, configurações). */
export async function seedCompanyDefaults(tx: DbTx, companyId: string) {
  await tx.insert(companySettings).values({ companyId });

  await tx.insert(paymentMethods).values([
    { companyId, name: "Dinheiro", code: "cash", sortOrder: 1 },
    { companyId, name: "PIX", code: "pix", sortOrder: 2 },
    { companyId, name: "Cartão de Débito", code: "debit", feePercent: "1.49", sortOrder: 3 },
    {
      companyId,
      name: "Cartão de Crédito",
      code: "credit",
      allowsInstallments: true,
      maxInstallments: 12,
      feePercent: "2.99",
      sortOrder: 4,
    },
    { companyId, name: "Crediário / Conta Cliente", code: "store_credit", sortOrder: 5 },
  ]);

  await tx.insert(financialCategories).values([
    { companyId, name: "Vendas de Mercadorias", type: "income", groupName: "Receitas Operacionais" },
    { companyId, name: "Compra de Mercadorias", type: "expense", groupName: "Custos Diretos" },
    { companyId, name: "Aluguel e Condomínio", type: "expense", groupName: "Despesas Fixas" },
    { companyId, name: "Energia, Água e Internet", type: "expense", groupName: "Despesas Fixas" },
    { companyId, name: "Folha de Pagamento", type: "expense", groupName: "Pessoal" },
  ]);

  await tx.insert(categories).values([{ companyId, name: "Geral" }]);
}
