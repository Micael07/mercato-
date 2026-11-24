-- ============================================================================
-- MERCATO ERP - Migration 002: Row Level Security (RLS), Views & Storage
-- ============================================================================

-- Helper: verifies active membership in company for authenticated Supabase user
CREATE OR REPLACE FUNCTION public.mercato_has_company_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_users cu
    JOIN public.companies c ON c.id = cu.company_id
    WHERE cu.company_id = p_company_id
      AND cu.user_id = auth.uid()
      AND cu.status = 'active'
      AND c.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.mercato_user_role(p_company_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT cu.role_code
  FROM public.company_users cu
  WHERE cu.company_id = p_company_id
    AND cu.user_id = auth.uid()
    AND cu.status = 'active'
  LIMIT 1;
$$;

-- Enable RLS across all tenant-scoped tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY companies_tenant_select ON companies
  FOR SELECT USING (public.mercato_has_company_access(id));

CREATE POLICY companies_admin_update ON companies
  FOR UPDATE USING (public.mercato_user_role(id) = 'admin');

CREATE POLICY establishments_tenant_all ON establishments
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY company_users_tenant_select ON company_users
  FOR SELECT USING (public.mercato_has_company_access(company_id));

CREATE POLICY company_users_admin_manage ON company_users
  FOR ALL USING (public.mercato_user_role(company_id) = 'admin')
  WITH CHECK (public.mercato_user_role(company_id) = 'admin');

CREATE POLICY company_settings_tenant_select ON company_settings
  FOR SELECT USING (public.mercato_has_company_access(company_id));

CREATE POLICY company_settings_admin_update ON company_settings
  FOR UPDATE USING (public.mercato_user_role(company_id) = 'admin');

CREATE POLICY payment_methods_tenant_all ON payment_methods
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY categories_tenant_all ON categories
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY suppliers_tenant_all ON suppliers
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY customers_tenant_all ON customers
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY products_tenant_all ON products
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY product_stocks_tenant_all ON product_stocks
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY product_price_history_tenant_select ON product_price_history
  FOR SELECT USING (
    public.mercato_has_company_access(company_id)
    AND public.mercato_user_role(company_id) IN ('admin', 'manager')
  );

CREATE POLICY stock_movements_tenant_select ON stock_movements
  FOR SELECT USING (public.mercato_has_company_access(company_id));

CREATE POLICY inventories_tenant_all ON inventories
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY purchase_orders_tenant_all ON purchase_orders
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY cash_registers_tenant_all ON cash_registers
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY cash_movements_tenant_all ON cash_movements
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY sales_tenant_all ON sales
  FOR ALL USING (public.mercato_has_company_access(company_id))
  WITH CHECK (public.mercato_has_company_access(company_id));

CREATE POLICY financial_categories_tenant_all ON financial_categories
  FOR ALL USING (
    public.mercato_has_company_access(company_id)
    AND public.mercato_user_role(company_id) IN ('admin', 'manager')
  );

CREATE POLICY financial_entries_tenant_all ON financial_entries
  FOR ALL USING (
    public.mercato_has_company_access(company_id)
    AND public.mercato_user_role(company_id) IN ('admin', 'manager')
  );

CREATE POLICY financial_settlements_tenant_all ON financial_settlements
  FOR ALL USING (
    public.mercato_has_company_access(company_id)
    AND public.mercato_user_role(company_id) IN ('admin', 'manager')
  );

-- Audit logs: append-only, readable only by admin
CREATE POLICY audit_logs_admin_read ON audit_logs
  FOR SELECT USING (public.mercato_user_role(company_id) = 'admin');

-- Secure View for POS (never exposes cost_price or margin_percent)
CREATE OR REPLACE VIEW public.v_products_pdv AS
SELECT
  p.id,
  p.company_id,
  p.internal_code,
  p.sku,
  p.barcode,
  p.name,
  p.short_name,
  p.category_id,
  p.unit,
  p.sale_price,
  p.allow_fractional,
  p.track_stock,
  p.status
FROM public.products p
WHERE p.status = 'active';
