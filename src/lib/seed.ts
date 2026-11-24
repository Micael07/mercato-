import { count, eq } from "drizzle-orm";
import {
  db,
  companies,
  establishments,
  users,
  companyUsers,
  companySettings,
  paymentMethods,
  categories,
  suppliers,
  customers,
  products,
  productStocks,
  financialCategories,
  purchaseOrders,
  purchaseOrderItems,
} from "@/db";
import { hashPassword } from "@/lib/auth";
import {
  completeSaleTx,
  openCashRegisterTx,
  receivePurchaseOrderTx,
} from "@/lib/services/erp";

export async function runDevelopmentSeed() {
  const [existingComp1] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.cnpj, "12345678000190"))
    .limit(1);

  if (existingComp1) {
    return {
      seeded: false,
      message: "Base de demonstração já foi inicializada.",
      accounts: [
        "admin@mercato.dev (Administrador - Acesso a Empresa A e Empresa B / Modelo B)",
        "gerente@mercato.dev (Gerente - Empresa A)",
        "caixa@mercato.dev (Operador de Caixa - Empresa A)",
        "estoque@mercato.dev (Estoquista - Empresa A)",
        "emporio@mercato.dev (Administrador - Empresa B / Modelo B)",
      ],
    };
  }

  const pwd = hashPassword("Mercato@2026");

  // 1. Companies
  const [comp1, comp2] = await db
    .insert(companies)
    .values([
      {
        legalName: "Casa Bella Cosméticos e Perfumaria Ltda",
        tradeName: "Casa Bella Cosméticos",
        cnpj: "12345678000190",
        stateRegistration: "110.220.330.440",
        phone: "(11) 3255-4800",
        email: "contato@casabella.com.br",
        address: "Rua Augusta, 1420",
        zipCode: "01304-001",
        city: "São Paulo",
        state: "SP",
      },
      {
        legalName: "Empório Paulista Mercado e Conveniência Ltda",
        tradeName: "Empório Paulista",
        cnpj: "98765432000110",
        stateRegistration: "220.330.440.550",
        phone: "(11) 3088-9200",
        email: "adm@emporiopaulista.com.br",
        address: "Rua dos Pinheiros, 615",
        zipCode: "05422-001",
        city: "São Paulo",
        state: "SP",
      },
    ])
    .returning();

  // 2. Establishments
  const [est1A, est1B, est2A] = await db
    .insert(establishments)
    .values([
      {
        companyId: comp1.id,
        name: "Matriz — Augusta",
        code: "001",
        cnpj: "12345678000190",
        address: "Rua Augusta, 1420 - Consolação",
        phone: "(11) 3255-4800",
        isDefault: true,
      },
      {
        companyId: comp1.id,
        name: "Filial 02 — Shopping Paulista",
        code: "002",
        cnpj: "12345678000271",
        address: "Rua Treze de Maio, 1947 - Bela Vista",
        phone: "(11) 3255-4899",
        isDefault: false,
      },
      {
        companyId: comp2.id,
        name: "Loja Pinheiros",
        code: "001",
        cnpj: "98765432000110",
        address: "Rua dos Pinheiros, 615",
        phone: "(11) 3088-9200",
        isDefault: true,
      },
    ])
    .returning();

  // 3. Users across 4 roles
  const [adminUser, managerUser, cashierUser, stockistUser, emp2User] = await db
    .insert(users)
    .values([
      { name: "Rafael Mendes", email: "admin@mercato.dev", passwordHash: pwd },
      { name: "Camila Ferreira", email: "gerente@mercato.dev", passwordHash: pwd },
      { name: "Lucas Oliveira", email: "caixa@mercato.dev", passwordHash: pwd },
      { name: "Bruno Santos", email: "estoque@mercato.dev", passwordHash: pwd },
      { name: "Mariana Costa", email: "emporio@mercato.dev", passwordHash: pwd },
    ])
    .returning();

  await db.insert(companyUsers).values([
    {
      companyId: comp1.id,
      userId: adminUser.id,
      defaultEstablishmentId: est1A.id,
      roleCode: "admin",
      maxDiscountPercent: "100.00",
    },
    {
      companyId: comp2.id,
      userId: adminUser.id,
      defaultEstablishmentId: est2A.id,
      roleCode: "admin",
      maxDiscountPercent: "100.00",
    },
    {
      companyId: comp1.id,
      userId: managerUser.id,
      defaultEstablishmentId: est1A.id,
      roleCode: "manager",
      maxDiscountPercent: "25.00",
    },
    {
      companyId: comp1.id,
      userId: cashierUser.id,
      defaultEstablishmentId: est1A.id,
      roleCode: "cashier",
      maxDiscountPercent: "5.00",
    },
    {
      companyId: comp1.id,
      userId: stockistUser.id,
      defaultEstablishmentId: est1A.id,
      roleCode: "stockist",
      maxDiscountPercent: "0.00",
    },
    {
      companyId: comp2.id,
      userId: emp2User.id,
      defaultEstablishmentId: est2A.id,
      roleCode: "admin",
      maxDiscountPercent: "100.00",
    },
  ]);

  const existingOtherUsers = await db.select().from(users);
  for (const eu of existingOtherUsers) {
    if (
      eu.email !== adminUser.email &&
      eu.email !== managerUser.email &&
      eu.email !== cashierUser.email &&
      eu.email !== stockistUser.email &&
      eu.email !== emp2User.email
    ) {
      await db
        .insert(companyUsers)
        .values([
          {
            companyId: comp1.id,
            userId: eu.id,
            defaultEstablishmentId: est1A.id,
            roleCode: "admin",
            maxDiscountPercent: "100.00",
          },
          {
            companyId: comp2.id,
            userId: eu.id,
            defaultEstablishmentId: est2A.id,
            roleCode: "admin",
            maxDiscountPercent: "100.00",
          },
        ])
        .onConflictDoNothing();
    }
  }

  await db.insert(companySettings).values([
    { companyId: comp1.id },
    { companyId: comp2.id },
  ]);

  // 4. Payment methods & Financial categories
  for (const cid of [comp1.id, comp2.id]) {
    await db.insert(paymentMethods).values([
      { companyId: cid, name: "Dinheiro", code: "cash", sortOrder: 1 },
      { companyId: cid, name: "PIX", code: "pix", sortOrder: 2 },
      {
        companyId: cid,
        name: "Cartão de Débito",
        code: "debit",
        feePercent: "1.49",
        sortOrder: 3,
      },
      {
        companyId: cid,
        name: "Cartão de Crédito",
        code: "credit",
        allowsInstallments: true,
        maxInstallments: 12,
        feePercent: "2.99",
        sortOrder: 4,
      },
      {
        companyId: cid,
        name: "Crediário",
        code: "store_credit",
        sortOrder: 5,
      },
    ]);

    await db.insert(financialCategories).values([
      {
        companyId: cid,
        name: "Vendas de Balcão",
        type: "income",
        groupName: "Receitas Operacionais",
      },
      {
        companyId: cid,
        name: "Compra de Mercadorias",
        type: "expense",
        groupName: "CMV",
      },
      {
        companyId: cid,
        name: "Aluguel e Condomínio",
        type: "expense",
        groupName: "Despesas Fixas",
      },
      {
        companyId: cid,
        name: "Energia e Telecom",
        type: "expense",
        groupName: "Despesas Fixas",
      },
    ]);
  }

  // 5. Categories, Suppliers, Customers, Products for Company 1
  const [catSkin, catHair, catPerfume] = await db
    .insert(categories)
    .values([
      { companyId: comp1.id, name: "Skincare & Facial" },
      { companyId: comp1.id, name: "Cuidados Capilares" },
      { companyId: comp1.id, name: "Perfumaria" },
    ])
    .returning();

  const [catBebidas] = await db
    .insert(categories)
    .values([{ companyId: comp2.id, name: "Bebidas & Mercearia" }])
    .returning();

  const [sup1, sup2] = await db
    .insert(suppliers)
    .values([
      {
        companyId: comp1.id,
        code: "FOR-001",
        personType: "PJ",
        document: "44555666000188",
        legalName: "Distribuidora Lumière Beauty S.A.",
        tradeName: "Lumière Distribuidora",
        contactName: "Fernanda Alves",
        phone: "(11) 4004-1900",
        email: "vendas@lumierebeauty.com.br",
        city: "Barueri",
        state: "SP",
        paymentTerms: "28/56 dias",
      },
      {
        companyId: comp1.id,
        code: "FOR-002",
        personType: "PJ",
        document: "77888999000122",
        legalName: "Essência Brasil Cosméticos Ltda",
        tradeName: "Essência Brasil",
        contactName: "Carlos Eduardo",
        phone: "(11) 3321-7700",
        email: "pedidos@essenciabrasil.com.br",
        city: "São Paulo",
        state: "SP",
        paymentTerms: "30 dias",
      },
    ])
    .returning();

  const [cust1, cust2] = await db
    .insert(customers)
    .values([
      {
        companyId: comp1.id,
        code: "CLI-001",
        name: "Juliana Martins Ribeiro",
        document: "38492019283",
        phone: "(11) 98765-4321",
        whatsapp: "(11) 98765-4321",
        email: "juliana.ribeiro@email.com",
        city: "São Paulo",
        state: "SP",
        creditLimit: "800.00",
      },
      {
        companyId: comp1.id,
        code: "CLI-002",
        name: "Patrícia Nogueira",
        document: "45123890122",
        phone: "(11) 97123-8800",
        email: "patricia.n@email.com",
        city: "São Paulo",
        state: "SP",
        creditLimit: "500.00",
      },
    ])
    .returning();

  const prodRows = await db
    .insert(products)
    .values([
      {
        companyId: comp1.id,
        internalCode: "PRD-001",
        sku: "SKN-VITC-30",
        barcode: "7891000100101",
        name: "Sérum Facial Vitamina C 15% 30ml",
        shortName: "Sérum Vit C 30ml",
        categoryId: catSkin.id,
        brand: "DermaPure",
        unit: "UN",
        costPrice: "42.5000",
        salePrice: "89.90",
        marginPercent: "111.53",
        minStock: "10.000",
        maxStock: "60.000",
        location: "A1-P2",
        mainSupplierId: sup1.id,
      },
      {
        companyId: comp1.id,
        internalCode: "PRD-002",
        sku: "SKN-HIDR-50",
        barcode: "7891000100102",
        name: "Gel Creme Hidratante Ácido Hialurônico 50g",
        shortName: "Hidratante Hialurônico",
        categoryId: catSkin.id,
        brand: "DermaPure",
        unit: "UN",
        costPrice: "34.0000",
        salePrice: "74.90",
        marginPercent: "120.29",
        minStock: "8.000",
        maxStock: "50.000",
        location: "A1-P3",
        mainSupplierId: sup1.id,
      },
      {
        companyId: comp1.id,
        internalCode: "PRD-003",
        sku: "CAP-SHMP-300",
        barcode: "7891000100201",
        name: "Shampoo Reconstrução Keratin Pro 300ml",
        shortName: "Shampoo Keratin 300ml",
        categoryId: catHair.id,
        brand: "LuxeHair",
        unit: "UN",
        costPrice: "21.0000",
        salePrice: "48.00",
        marginPercent: "128.57",
        minStock: "12.000",
        maxStock: "80.000",
        location: "B2-P1",
        mainSupplierId: sup2.id,
      },
      {
        companyId: comp1.id,
        internalCode: "PRD-004",
        sku: "CAP-MASC-250",
        barcode: "7891000100202",
        name: "Máscara Capilar Nutrição Intensa 250g",
        shortName: "Máscara Nutrição 250g",
        categoryId: catHair.id,
        brand: "LuxeHair",
        unit: "UN",
        costPrice: "26.5000",
        salePrice: "59.90",
        marginPercent: "126.04",
        minStock: "10.000",
        maxStock: "45.000",
        location: "B2-P2",
        mainSupplierId: sup2.id,
      },
      {
        companyId: comp1.id,
        internalCode: "PRD-005",
        sku: "PRF-EAU-100",
        barcode: "7891000100301",
        name: "Eau de Parfum Florale Noir 100ml",
        shortName: "EDP Florale Noir 100ml",
        categoryId: catPerfume.id,
        brand: "Atelier",
        unit: "UN",
        costPrice: "118.0000",
        salePrice: "249.00",
        marginPercent: "111.02",
        minStock: "5.000",
        maxStock: "25.000",
        location: "VITRINE-1",
        mainSupplierId: sup1.id,
      },
      {
        companyId: comp1.id,
        internalCode: "PRD-006",
        sku: "SKN-PROT-60",
        barcode: "7891000100109",
        name: "Protetor Solar FPS 60 Toque Seco 50ml",
        shortName: "Protetor FPS 60",
        categoryId: catSkin.id,
        brand: "DermaPure",
        unit: "UN",
        costPrice: "29.0000",
        salePrice: "64.90",
        marginPercent: "123.79",
        minStock: "15.000",
        maxStock: "60.000",
        location: "A2-P1",
        mainSupplierId: sup1.id,
      },
    ])
    .returning();

  // Same barcode allowed in Company 2!
  const [emp2Prod] = await db
    .insert(products)
    .values({
      companyId: comp2.id,
      internalCode: "EMP-001",
      sku: "BEB-AGU-500",
      barcode: "7891000100101",
      name: "Água Mineral Sem Gás 500ml",
      shortName: "Água 500ml",
      categoryId: catBebidas.id,
      brand: "Serra Pura",
      unit: "UN",
      costPrice: "1.1000",
      salePrice: "3.50",
      marginPercent: "218.18",
      minStock: "48.000",
      maxStock: "300.000",
    })
    .returning();

  await db.insert(productStocks).values([
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[0].id, quantity: "28.000" },
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[1].id, quantity: "16.000" },
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[2].id, quantity: "34.000" },
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[3].id, quantity: "6.000" }, // low stock
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[4].id, quantity: "11.000" },
    { companyId: comp1.id, establishmentId: est1A.id, productId: prodRows[5].id, quantity: "0.000" }, // out of stock
    { companyId: comp1.id, establishmentId: est1B.id, productId: prodRows[0].id, quantity: "14.000" },
    { companyId: comp2.id, establishmentId: est2A.id, productId: emp2Prod.id, quantity: "120.000" },
  ]);

  // 6. Purchase Order + Receipt
  const [po1] = await db
    .insert(purchaseOrders)
    .values({
      companyId: comp1.id,
      establishmentId: est1A.id,
      supplierId: sup1.id,
      orderNumber: 101,
      status: "approved",
      subtotal: "1275.00",
      total: "1275.00",
      paymentTerms: "28 dias",
      createdBy: adminUser.id,
      approvedBy: adminUser.id,
    })
    .returning();

  const [po1Item] = await db
    .insert(purchaseOrderItems)
    .values({
      purchaseOrderId: po1.id,
      productId: prodRows[0].id,
      quantityOrdered: "30.000",
      quantityReceived: "0.000",
      unitCost: "42.5000",
      total: "1275.00",
    })
    .returning();

  await receivePurchaseOrderTx({
    companyId: comp1.id,
    establishmentId: est1A.id,
    purchaseOrderId: po1.id,
    invoiceNumber: "NF-004982",
    userId: adminUser.id,
    userName: adminUser.name,
    items: [{ itemId: po1Item.id, quantityReceiving: 30 }],
  });

  // 7. Open cash register & initial real sales
  const cashReg = await openCashRegisterTx({
    companyId: comp1.id,
    establishmentId: est1A.id,
    userId: adminUser.id,
    userName: adminUser.name,
    terminalName: "Caixa Principal 01",
    openingAmount: 300,
  });

  await completeSaleTx({
    companyId: comp1.id,
    establishmentId: est1A.id,
    operatorId: adminUser.id,
    operatorName: adminUser.name,
    operatorRole: "admin",
    operatorMaxDiscountPercent: 100,
    customerId: cust1.id,
    cashRegisterId: cashReg.id,
    items: [
      { productId: prodRows[0].id, quantity: 2 },
      { productId: prodRows[4].id, quantity: 1 },
    ],
    payments: [
      { paymentMethodCode: "pix", paymentMethodName: "PIX", amount: 228.8 },
      { paymentMethodCode: "cash", paymentMethodName: "Dinheiro", amount: 200.0 },
    ],
  });

  await completeSaleTx({
    companyId: comp1.id,
    establishmentId: est1A.id,
    operatorId: adminUser.id,
    operatorName: adminUser.name,
    operatorRole: "admin",
    operatorMaxDiscountPercent: 100,
    customerId: cust2.id,
    cashRegisterId: cashReg.id,
    items: [
      { productId: prodRows[2].id, quantity: 2 },
      { productId: prodRows[3].id, quantity: 1 },
    ],
    payments: [
      { paymentMethodCode: "credit", paymentMethodName: "Cartão de Crédito", amount: 155.9, installments: 2 },
    ],
  });

  return {
    seeded: true,
    message: "Dados de demonstração criados com sucesso.",
    accounts: [
      "admin@mercato.dev (Administrador - Acesso a Casa Bella e Empório Paulista)",
      "gerente@mercato.dev (Gerente - Casa Bella)",
      "caixa@mercato.dev (Operador de Caixa - Casa Bella)",
      "estoque@mercato.dev (Estoquista - Casa Bella)",
      "emporio@mercato.dev (Administrador - Empório Paulista)",
    ],
  };
}
