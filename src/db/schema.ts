import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// 1. MULTI-COMPANY & ESTABLISHMENTS
// ============================================================================

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    tradeName: varchar("trade_name", { length: 200 }).notNull(),
    cnpj: varchar("cnpj", { length: 20 }).notNull(),
    stateRegistration: varchar("state_registration", { length: 40 }),
    municipalRegistration: varchar("municipal_registration", { length: 40 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 160 }),
    address: varchar("address", { length: 250 }),
    zipCode: varchar("zip_code", { length: 15 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 2 }),
    logoUrl: text("logo_url"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    // Licenciamento: pending (sem acesso) | trial | active | suspended
    licenseStatus: varchar("license_status", { length: 20 }).notNull().default("pending"),
    licensePlan: varchar("license_plan", { length: 60 }),
    licenseExpiresAt: timestamp("license_expires_at", { withTimezone: true }),
    licenseNotes: text("license_notes"),
    licenseUpdatedAt: timestamp("license_updated_at", { withTimezone: true }),
    // Limite de usuários definido pelo ADM da plataforma e quem autoriza novos: platform | company
    maxUsers: integer("max_users").notNull().default(3),
    userApprovalMode: varchar("user_approval_mode", { length: 20 }).notNull().default("platform"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("companies_cnpj_uidx").on(table.cnpj)]
);

export const licenseEvents = pgTable(
  "license_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 40 }).notNull(),
    previousStatus: varchar("previous_status", { length: 20 }),
    newStatus: varchar("new_status", { length: 20 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
    createdByName: varchar("created_by_name", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("license_events_company_idx").on(table.companyId, table.createdAt)]
);

export const establishments = pgTable(
  "establishments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    cnpj: varchar("cnpj", { length: 20 }),
    address: varchar("address", { length: 250 }),
    phone: varchar("phone", { length: 30 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("establishments_company_idx").on(table.companyId),
    uniqueIndex("establishments_company_code_uidx").on(table.companyId, table.code),
  ]
);

// ============================================================================
// 2. USERS, ROLES, PERMISSIONS & INVITES
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 180 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    phone: varchar("phone", { length: 30 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    resetToken: varchar("reset_token", { length: 120 }),
    resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
    sessionValidAfter: timestamp("session_valid_after", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // Senha provisória: obriga a troca no primeiro acesso
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // HMAC de CPF + nome + nascimento, usado na recuperação de senha sem e-mail
    recoveryHash: text("recovery_hash"),
    recoveryFailedAttempts: integer("recovery_failed_attempts").notNull().default(0),
    recoveryLockedUntil: timestamp("recovery_locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)]
);

export const companyUsers = pgTable(
  "company_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultEstablishmentId: uuid("default_establishment_id").references(
      () => establishments.id,
      { onDelete: "set null" }
    ),
    roleCode: varchar("role_code", { length: 40 }).notNull().default("cashier"),
    customPermissions: jsonb("custom_permissions")
      .$type<{ granted?: string[]; revoked?: string[] }>()
      .default({})
      .notNull(),
    maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("5.00"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("company_users_company_user_uidx").on(table.companyId, table.userId),
    index("company_users_user_idx").on(table.userId),
  ]
);

export const userInvites = pgTable(
  "user_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id").references(() => establishments.id, {
      onDelete: "set null",
    }),
    email: varchar("email", { length: 180 }).notNull(),
    name: varchar("name", { length: 160 }),
    roleCode: varchar("role_code", { length: 40 }).notNull(),
    token: varchar("token", { length: 120 }).notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_invites_token_uidx").on(table.token),
    index("user_invites_company_idx").on(table.companyId),
  ]
);

export const userRequests = pgTable(
  "user_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    roleCode: varchar("role_code", { length: 40 }).notNull().default("cashier"),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedByName: varchar("requested_by_name", { length: 160 }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedByName: varchar("decided_by_name", { length: 160 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    recoveryHash: text("recovery_hash"),
    createdUserId: uuid("created_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("user_requests_company_idx").on(table.companyId, table.status)]
);

export const roleChangeHistory = pgTable(
  "role_change_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    previousRole: varchar("previous_role", { length: 40 }),
    newRole: varchar("new_role", { length: 40 }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("role_change_history_company_idx").on(table.companyId)]
);

// ============================================================================
// 3. SETTINGS & PAYMENT METHODS
// ============================================================================

export const companySettings = pgTable("company_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" })
    .unique(),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  allowDuplicateBarcode: boolean("allow_duplicate_barcode").notNull().default(false),
  maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("10.00"),
  managerMaxDiscountPercent: numeric("manager_max_discount_percent", {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default("25.00"),
  decimalPlaces: integer("decimal_places").notNull().default(2),
  currency: varchar("currency", { length: 10 }).notNull().default("BRL"),
  timezone: varchar("timezone", { length: 60 }).notNull().default("America/Sao_Paulo"),
  dateFormat: varchar("date_format", { length: 20 }).notNull().default("dd/MM/yyyy"),
  requireOpenCashRegister: boolean("require_open_cash_register").notNull().default(true),
  singleOpenCashPerOperator: boolean("single_open_cash_per_operator")
    .notNull()
    .default(true),
  receiptFooter: text("receipt_footer")
    .notNull()
    .default("Obrigado pela preferência! Volte sempre."),
  thermalPrintEnabled: boolean("thermal_print_enabled").notNull().default(true),
  nextSaleNumber: integer("next_sale_number").notNull().default(1001),
  nextPurchaseNumber: integer("next_purchase_number").notNull().default(101),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    allowsInstallments: boolean("allows_installments").notNull().default(false),
    maxInstallments: integer("max_installments").notNull().default(1),
    feePercent: numeric("fee_percent", { precision: 5, scale: 2 }).notNull().default("0.00"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("payment_methods_company_idx").on(table.companyId)]
);

// ============================================================================
// 4. CATEGORIES, SUPPLIERS, CUSTOMERS, PRODUCTS
// ============================================================================

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    parentId: uuid("parent_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("categories_company_idx").on(table.companyId)]
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 30 }).notNull(),
    personType: varchar("person_type", { length: 5 }).notNull().default("PJ"),
    document: varchar("document", { length: 20 }),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    tradeName: varchar("trade_name", { length: 200 }),
    contactName: varchar("contact_name", { length: 120 }),
    phone: varchar("phone", { length: 30 }),
    whatsapp: varchar("whatsapp", { length: 30 }),
    email: varchar("email", { length: 160 }),
    address: varchar("address", { length: 250 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 2 }),
    zipCode: varchar("zip_code", { length: 15 }),
    paymentTerms: varchar("payment_terms", { length: 120 }),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("suppliers_company_idx").on(table.companyId),
    index("suppliers_name_idx").on(table.companyId, table.legalName),
  ]
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    document: varchar("document", { length: 20 }),
    phone: varchar("phone", { length: 30 }),
    whatsapp: varchar("whatsapp", { length: 30 }),
    email: varchar("email", { length: 160 }),
    birthDate: date("birth_date"),
    address: varchar("address", { length: 250 }),
    zipCode: varchar("zip_code", { length: 15 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 2 }),
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    openBalance: numeric("open_balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customers_company_idx").on(table.companyId),
    index("customers_name_idx").on(table.companyId, table.name),
  ]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    internalCode: varchar("internal_code", { length: 40 }).notNull(),
    sku: varchar("sku", { length: 60 }).notNull(),
    barcode: varchar("barcode", { length: 60 }),
    name: varchar("name", { length: 220 }).notNull(),
    shortName: varchar("short_name", { length: 80 }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    brand: varchar("brand", { length: 100 }),
    unit: varchar("unit", { length: 12 }).notNull().default("UN"),
    costPrice: numeric("cost_price", { precision: 12, scale: 4 }).notNull().default("0.0000"),
    salePrice: numeric("sale_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
    marginPercent: numeric("margin_percent", { precision: 8, scale: 2 })
      .notNull()
      .default("0.00"),
    minStock: numeric("min_stock", { precision: 12, scale: 3 }).notNull().default("0.000"),
    maxStock: numeric("max_stock", { precision: 12, scale: 3 }).notNull().default("0.000"),
    location: varchar("location", { length: 80 }),
    mainSupplierId: uuid("main_supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    imageUrl: text("image_url"),
    allowFractional: boolean("allow_fractional").notNull().default(false),
    trackStock: boolean("track_stock").notNull().default(true),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("products_company_idx").on(table.companyId),
    index("products_name_idx").on(table.companyId, table.name),
    index("products_sku_idx").on(table.companyId, table.sku),
    index("products_barcode_idx").on(table.companyId, table.barcode),
    uniqueIndex("products_company_sku_uidx").on(table.companyId, table.sku),
    uniqueIndex("products_company_barcode_uidx")
      .on(table.companyId, table.barcode)
      .where(sql`${table.barcode} is not null and ${table.barcode} <> ''`),
  ]
);

export const productStocks = pgTable(
  "product_stocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("0.000"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_stocks_est_prod_uidx").on(table.establishmentId, table.productId),
    index("product_stocks_company_idx").on(table.companyId, table.establishmentId),
  ]
);

export const productPriceHistory = pgTable(
  "product_price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    previousCost: numeric("previous_cost", { precision: 12, scale: 4 }).notNull(),
    newCost: numeric("new_cost", { precision: 12, scale: 4 }).notNull(),
    previousPrice: numeric("previous_price", { precision: 12, scale: 2 }).notNull(),
    newPrice: numeric("new_price", { precision: 12, scale: 2 }).notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    reason: varchar("reason", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("product_price_history_prod_idx").on(table.companyId, table.productId)]
);

// ============================================================================
// 5. STOCK MOVEMENTS & INVENTORIES
// ============================================================================

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    previousBalance: numeric("previous_balance", { precision: 12, scale: 3 }).notNull(),
    newBalance: numeric("new_balance", { precision: 12, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 4 }).notNull().default("0.0000"),
    originDocument: varchar("origin_document", { length: 80 }),
    originId: uuid("origin_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    justification: text("justification"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("stock_movements_company_est_idx").on(table.companyId, table.establishmentId),
    index("stock_movements_product_idx").on(table.productId, table.createdAt),
    index("stock_movements_date_idx").on(table.companyId, table.createdAt),
  ]
);

export const inventories = pgTable(
  "inventories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("counting"),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (table) => [index("inventories_company_idx").on(table.companyId, table.establishmentId)]
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => inventories.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    systemQuantity: numeric("system_quantity", { precision: 12, scale: 3 }).notNull(),
    countedQuantity: numeric("counted_quantity", { precision: 12, scale: 3 }),
    recountQuantity: numeric("recount_quantity", { precision: 12, scale: 3 }),
    divergence: numeric("divergence", { precision: 12, scale: 3 })
      .notNull()
      .default("0.000"),
    adjusted: boolean("adjusted").notNull().default(false),
    notes: varchar("notes", { length: 250 }),
  },
  (table) => [index("inventory_items_inv_idx").on(table.inventoryId)]
);

// ============================================================================
// 6. PURCHASES & RECEIPTS
// ============================================================================

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    orderNumber: integer("order_number").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    freight: numeric("freight", { precision: 12, scale: 2 }).notNull().default("0.00"),
    taxes: numeric("taxes", { precision: 12, scale: 2 }).notNull().default("0.00"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0.00"),
    paymentTerms: varchar("payment_terms", { length: 120 }),
    expectedDelivery: date("expected_delivery"),
    notes: text("notes"),
    attachmentUrl: text("attachment_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("purchase_orders_company_idx").on(table.companyId, table.establishmentId),
    index("purchase_orders_status_idx").on(table.companyId, table.status),
  ]
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantityOrdered: numeric("quantity_ordered", { precision: 12, scale: 3 }).notNull(),
    quantityReceived: numeric("quantity_received", { precision: 12, scale: 3 })
      .notNull()
      .default("0.000"),
    unitCost: numeric("unit_cost", { precision: 12, scale: 4 }).notNull(),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [index("purchase_order_items_po_idx").on(table.purchaseOrderId)]
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    invoiceNumber: varchar("invoice_number", { length: 60 }),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("purchase_receipts_po_idx").on(table.purchaseOrderId)]
);

// ============================================================================
// 7. CASH REGISTERS & POS SALES
// ============================================================================

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    terminalName: varchar("terminal_name", { length: 80 }).notNull().default("Caixa 01"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    openingAmount: numeric("opening_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    currentBalance: numeric("current_balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    expectedClosingAmount: numeric("expected_closing_amount", {
      precision: 12,
      scale: 2,
    }),
    countedClosingAmount: numeric("counted_closing_amount", {
      precision: 12,
      scale: 2,
    }),
    differenceAmount: numeric("difference_amount", { precision: 12, scale: 2 }),
    differenceJustification: text("difference_justification"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closingNotes: text("closing_notes"),
  },
  (table) => [
    index("cash_registers_company_est_idx").on(table.companyId, table.establishmentId),
    index("cash_registers_status_idx").on(table.companyId, table.status),
  ]
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    cashRegisterId: uuid("cash_register_id")
      .notNull()
      .references(() => cashRegisters.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    paymentMethodCode: varchar("payment_method_code", { length: 30 }).default("cash"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    originId: uuid("origin_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("cash_movements_register_idx").on(table.cashRegisterId, table.createdAt)]
);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    saleNumber: integer("sale_number").notNull(),
    cashRegisterId: uuid("cash_register_id").references(() => cashRegisters.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    operatorId: uuid("operator_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 30 }).notNull().default("completed"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
    discountTotal: numeric("discount_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    surchargeTotal: numeric("surcharge_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0.00"),
    changeAmount: numeric("change_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    notes: text("notes"),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sales_company_est_idx").on(table.companyId, table.establishmentId),
    index("sales_date_idx").on(table.companyId, table.createdAt),
    index("sales_status_idx").on(table.companyId, table.status),
  ]
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productName: varchar("product_name", { length: 220 }).notNull(),
    sku: varchar("sku", { length: 60 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    costPriceSnapshot: numeric("cost_price_snapshot", { precision: 12, scale: 4 })
      .notNull()
      .default("0.0000"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    returnedQuantity: numeric("returned_quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("0.000"),
  },
  (table) => [index("sale_items_sale_idx").on(table.saleId)]
);

export const salePayments = pgTable(
  "sale_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id, {
      onDelete: "set null",
    }),
    paymentMethodName: varchar("payment_method_name", { length: 80 }).notNull(),
    paymentMethodCode: varchar("payment_method_code", { length: 30 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    installments: integer("installments").notNull().default(1),
    reference: varchar("reference", { length: 120 }),
  },
  (table) => [index("sale_payments_sale_idx").on(table.saleId)]
);

// ============================================================================
// 8. FINANCIAL (PAYABLES, RECEIVABLES, CASH FLOW, SETTLEMENTS)
// ============================================================================

export const financialCategories = pgTable(
  "financial_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // 'income' | 'expense'
    groupName: varchar("group_name", { length: 80 }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("financial_categories_company_idx").on(table.companyId)]
);

export const financialEntries = pgTable(
  "financial_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(), // 'payable' | 'receivable'
    originType: varchar("origin_type", { length: 20 }).notNull().default("manual"),
    originId: uuid("origin_id"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    categoryId: uuid("category_id").references(() => financialCategories.id, {
      onDelete: "set null",
    }),
    description: varchar("description", { length: 240 }).notNull(),
    competenceDate: date("competence_date").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    interest: numeric("interest", { precision: 12, scale: 2 }).notNull().default("0.00"),
    penalty: numeric("penalty", { precision: 12, scale: 2 }).notNull().default("0.00"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    paymentMethodCode: varchar("payment_method_code", { length: 30 }),
    recurrence: varchar("recurrence", { length: 30 }).default("none"),
    attachmentUrl: text("attachment_url"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("financial_entries_company_est_idx").on(table.companyId, table.establishmentId),
    index("financial_entries_due_idx").on(table.companyId, table.dueDate),
    index("financial_entries_status_idx").on(table.companyId, table.status),
  ]
);

export const financialSettlements = pgTable(
  "financial_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => financialEntries.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    interest: numeric("interest", { precision: 12, scale: 2 }).notNull().default("0.00"),
    penalty: numeric("penalty", { precision: 12, scale: 2 }).notNull().default("0.00"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    paymentMethodCode: varchar("payment_method_code", { length: 30 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).defaultNow().notNull(),
    settledBy: uuid("settled_by").references(() => users.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversalReason: text("reversal_reason"),
    notes: text("notes"),
  },
  (table) => [index("financial_settlements_entry_idx").on(table.entryId)]
);

// ============================================================================
// 9. AUDIT LOGS
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    establishmentId: uuid("establishment_id").references(() => establishments.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: varchar("user_name", { length: 160 }),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 80 }),
    previousData: jsonb("previous_data"),
    newData: jsonb("new_data"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_company_date_idx").on(table.companyId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entity, table.entityId),
  ]
);
