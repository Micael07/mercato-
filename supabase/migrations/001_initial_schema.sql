-- ============================================================================
-- MERCATO ERP - Migration 001: Initial Multi-Tenant Schema & Indexes
-- Compatible with PostgreSQL 15+ and Supabase
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Companies & Establishments
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name varchar(200) NOT NULL,
  trade_name varchar(200) NOT NULL,
  cnpj varchar(20) NOT NULL UNIQUE,
  state_registration varchar(40),
  municipal_registration varchar(40),
  phone varchar(30),
  email varchar(160),
  address varchar(250),
  zip_code varchar(15),
  city varchar(120),
  state varchar(2),
  logo_url text,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(180) NOT NULL,
  code varchar(30) NOT NULL,
  cnpj varchar(20),
  address varchar(250),
  phone varchar(30),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_default boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS establishments_company_idx ON establishments(company_id);

-- 2. Users, Memberships, Invites & Role History
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  email varchar(180) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  phone varchar(30),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  reset_token varchar(120),
  reset_token_expires_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_establishment_id uuid REFERENCES establishments(id) ON DELETE SET NULL,
  role_code varchar(40) NOT NULL DEFAULT 'cashier' CHECK (role_code IN ('admin', 'manager', 'cashier', 'stockist')),
  custom_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_discount_percent numeric(5,2) NOT NULL DEFAULT 5.00,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS company_users_user_idx ON company_users(user_id);

CREATE TABLE IF NOT EXISTS user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid REFERENCES establishments(id) ON DELETE SET NULL,
  email varchar(180) NOT NULL,
  name varchar(160),
  role_code varchar(40) NOT NULL,
  token varchar(120) NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_invites_company_idx ON user_invites(company_id);

CREATE TABLE IF NOT EXISTS role_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_role varchar(40),
  new_role varchar(40) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS role_change_history_company_idx ON role_change_history(company_id);

-- 3. Company Settings & Payment Methods
CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  allow_duplicate_barcode boolean NOT NULL DEFAULT false,
  max_discount_percent numeric(5,2) NOT NULL DEFAULT 10.00,
  manager_max_discount_percent numeric(5,2) NOT NULL DEFAULT 25.00,
  decimal_places integer NOT NULL DEFAULT 2,
  currency varchar(10) NOT NULL DEFAULT 'BRL',
  timezone varchar(60) NOT NULL DEFAULT 'America/Sao_Paulo',
  date_format varchar(20) NOT NULL DEFAULT 'dd/MM/yyyy',
  require_open_cash_register boolean NOT NULL DEFAULT true,
  single_open_cash_per_operator boolean NOT NULL DEFAULT true,
  receipt_footer text NOT NULL DEFAULT 'Obrigado pela preferência! Volte sempre.',
  thermal_print_enabled boolean NOT NULL DEFAULT true,
  next_sale_number integer NOT NULL DEFAULT 1001,
  next_purchase_number integer NOT NULL DEFAULT 101,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  code varchar(30) NOT NULL,
  allows_installments boolean NOT NULL DEFAULT false,
  max_installments integer NOT NULL DEFAULT 1,
  fee_percent numeric(5,2) NOT NULL DEFAULT 0.00,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_methods_company_idx ON payment_methods(company_id);

-- 4. Categories, Suppliers, Customers, Products
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  parent_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_company_idx ON categories(company_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  person_type varchar(5) NOT NULL DEFAULT 'PJ',
  document varchar(20),
  legal_name varchar(200) NOT NULL,
  trade_name varchar(200),
  contact_name varchar(120),
  phone varchar(30),
  whatsapp varchar(30),
  email varchar(160),
  address varchar(250),
  city varchar(120),
  state varchar(2),
  zip_code varchar(15),
  payment_terms varchar(120),
  notes text,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_company_idx ON suppliers(company_id);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  name varchar(180) NOT NULL,
  document varchar(20),
  phone varchar(30),
  whatsapp varchar(30),
  email varchar(160),
  birth_date date,
  address varchar(250),
  zip_code varchar(15),
  city varchar(120),
  state varchar(2),
  credit_limit numeric(12,2) NOT NULL DEFAULT 0.00,
  open_balance numeric(12,2) NOT NULL DEFAULT 0.00,
  notes text,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_company_idx ON customers(company_id);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  internal_code varchar(40) NOT NULL,
  sku varchar(60) NOT NULL,
  barcode varchar(60),
  name varchar(220) NOT NULL,
  short_name varchar(80),
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  brand varchar(100),
  unit varchar(12) NOT NULL DEFAULT 'UN',
  cost_price numeric(12,4) NOT NULL DEFAULT 0.0000,
  sale_price numeric(12,2) NOT NULL DEFAULT 0.00,
  margin_percent numeric(8,2) NOT NULL DEFAULT 0.00,
  min_stock numeric(12,3) NOT NULL DEFAULT 0.000,
  max_stock numeric(12,3) NOT NULL DEFAULT 0.000,
  location varchar(80),
  main_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  image_url text,
  allow_fractional boolean NOT NULL DEFAULT false,
  track_stock boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE UNIQUE INDEX IF NOT EXISTS products_company_barcode_uidx
  ON products(company_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS products_company_idx ON products(company_id);
CREATE INDEX IF NOT EXISTS products_name_idx ON products(company_id, name);

CREATE TABLE IF NOT EXISTS product_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity numeric(12,3) NOT NULL DEFAULT 0.000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, product_id)
);
CREATE INDEX IF NOT EXISTS product_stocks_company_idx ON product_stocks(company_id, establishment_id);

CREATE TABLE IF NOT EXISTS product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  previous_cost numeric(12,4) NOT NULL,
  new_cost numeric(12,4) NOT NULL,
  previous_price numeric(12,2) NOT NULL,
  new_price numeric(12,2) NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_price_history_prod_idx ON product_price_history(company_id, product_id);

-- 5. Stock Movements, Inventories, Purchases, Cash, Sales, Financial, Audit
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type varchar(30) NOT NULL,
  quantity numeric(12,3) NOT NULL,
  previous_balance numeric(12,3) NOT NULL,
  new_balance numeric(12,3) NOT NULL,
  unit_cost numeric(12,4) NOT NULL DEFAULT 0.0000,
  origin_document varchar(80),
  origin_id uuid,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  justification text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_company_est_idx ON stock_movements(company_id, establishment_id);
CREATE INDEX IF NOT EXISTS stock_movements_date_idx ON stock_movements(company_id, created_at);

CREATE TABLE IF NOT EXISTS inventories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  description varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'counting',
  opened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  system_quantity numeric(12,3) NOT NULL,
  counted_quantity numeric(12,3),
  recount_quantity numeric(12,3),
  divergence numeric(12,3) NOT NULL DEFAULT 0.000,
  adjusted boolean NOT NULL DEFAULT false,
  notes varchar(250)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_number integer NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'draft',
  subtotal numeric(12,2) NOT NULL DEFAULT 0.00,
  discount numeric(12,2) NOT NULL DEFAULT 0.00,
  freight numeric(12,2) NOT NULL DEFAULT 0.00,
  taxes numeric(12,2) NOT NULL DEFAULT 0.00,
  total numeric(12,2) NOT NULL DEFAULT 0.00,
  payment_terms varchar(120),
  expected_delivery date,
  notes text,
  attachment_url text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_company_idx ON purchase_orders(company_id, establishment_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered numeric(12,3) NOT NULL,
  quantity_received numeric(12,3) NOT NULL DEFAULT 0.000,
  unit_cost numeric(12,4) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0.00,
  total numeric(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  invoice_number varchar(60),
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  terminal_name varchar(80) NOT NULL DEFAULT 'Caixa 01',
  status varchar(20) NOT NULL DEFAULT 'open',
  opening_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  current_balance numeric(12,2) NOT NULL DEFAULT 0.00,
  expected_closing_amount numeric(12,2),
  counted_closing_amount numeric(12,2),
  difference_amount numeric(12,2),
  difference_justification text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closing_notes text
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  type varchar(30) NOT NULL,
  payment_method_code varchar(30) DEFAULT 'cash',
  amount numeric(12,2) NOT NULL,
  description varchar(240) NOT NULL,
  origin_id uuid,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  sale_number integer NOT NULL,
  cash_register_id uuid REFERENCES cash_registers(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  operator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(30) NOT NULL DEFAULT 'completed',
  subtotal numeric(12,2) NOT NULL DEFAULT 0.00,
  discount_total numeric(12,2) NOT NULL DEFAULT 0.00,
  surcharge_total numeric(12,2) NOT NULL DEFAULT 0.00,
  total numeric(12,2) NOT NULL DEFAULT 0.00,
  change_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  notes text,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_company_est_idx ON sales(company_id, establishment_id);
CREATE INDEX IF NOT EXISTS sales_date_idx ON sales(company_id, created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name varchar(220) NOT NULL,
  sku varchar(60) NOT NULL,
  quantity numeric(12,3) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  cost_price_snapshot numeric(12,4) NOT NULL DEFAULT 0.0000,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  total numeric(12,2) NOT NULL,
  returned_quantity numeric(12,3) NOT NULL DEFAULT 0.000
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  payment_method_name varchar(80) NOT NULL,
  payment_method_code varchar(30) NOT NULL,
  amount numeric(12,2) NOT NULL,
  installments integer NOT NULL DEFAULT 1,
  reference varchar(120)
);

CREATE TABLE IF NOT EXISTS financial_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  type varchar(20) NOT NULL CHECK (type IN ('income', 'expense')),
  group_name varchar(80),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL CHECK (type IN ('payable', 'receivable')),
  origin_type varchar(20) NOT NULL DEFAULT 'manual',
  origin_id uuid,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  category_id uuid REFERENCES financial_categories(id) ON DELETE SET NULL,
  description varchar(240) NOT NULL,
  competence_date date NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  interest numeric(12,2) NOT NULL DEFAULT 0.00,
  penalty numeric(12,2) NOT NULL DEFAULT 0.00,
  discount numeric(12,2) NOT NULL DEFAULT 0.00,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  status varchar(20) NOT NULL DEFAULT 'open',
  payment_method_code varchar(30),
  recurrence varchar(30) DEFAULT 'none',
  attachment_url text,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_entries_company_est_idx ON financial_entries(company_id, establishment_id);
CREATE INDEX IF NOT EXISTS financial_entries_due_idx ON financial_entries(company_id, due_date);

CREATE TABLE IF NOT EXISTS financial_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  interest numeric(12,2) NOT NULL DEFAULT 0.00,
  penalty numeric(12,2) NOT NULL DEFAULT 0.00,
  discount numeric(12,2) NOT NULL DEFAULT 0.00,
  payment_method_code varchar(30) NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  settled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason text,
  notes text
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id uuid REFERENCES establishments(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name varchar(160),
  action varchar(80) NOT NULL,
  entity varchar(80) NOT NULL,
  entity_id varchar(80),
  previous_data jsonb,
  new_data jsonb,
  ip_address varchar(64),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_date_idx ON audit_logs(company_id, created_at);
