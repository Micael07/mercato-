-- ============================================================================
-- MERCATO ERP - Migration 003: Transactional RPCs & Guardrail Triggers
-- ============================================================================

-- Guardrail: Protect last active administrator per company
CREATE OR REPLACE FUNCTION public.prevent_removing_last_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF (OLD.role_code = 'admin' AND OLD.status = 'active')
     AND (TG_OP = 'DELETE' OR NEW.role_code <> 'admin' OR NEW.status <> 'active') THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.company_users
    WHERE company_id = OLD.company_id
      AND role_code = 'admin'
      AND status = 'active'
      AND id <> OLD.id;
    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'Cannot remove or deactivate the last active administrator of a company.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_admin ON public.company_users;
CREATE TRIGGER trg_protect_last_admin
  BEFORE UPDATE OR DELETE ON public.company_users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_removing_last_admin();

-- Transactional RPC: Move Stock
CREATE OR REPLACE FUNCTION public.rpc_move_stock(
  p_company_id uuid,
  p_establishment_id uuid,
  p_product_id uuid,
  p_type varchar,
  p_delta numeric,
  p_origin_document varchar DEFAULT NULL,
  p_origin_id uuid DEFAULT NULL,
  p_justification text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allow_negative boolean;
  v_track_stock boolean;
  v_prev_balance numeric(12,3);
  v_new_balance numeric(12,3);
  v_cost numeric(12,4);
BEGIN
  IF NOT public.mercato_has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'Unauthorized company access.';
  END IF;

  SELECT track_stock, cost_price INTO v_track_stock, v_cost
  FROM public.products
  WHERE id = p_product_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found for company.';
  END IF;

  IF NOT v_track_stock THEN
    RETURN 0;
  END IF;

  SELECT allow_negative_stock INTO v_allow_negative
  FROM public.company_settings
  WHERE company_id = p_company_id;

  INSERT INTO public.product_stocks(company_id, establishment_id, product_id, quantity)
  VALUES (p_company_id, p_establishment_id, p_product_id, 0)
  ON CONFLICT (establishment_id, product_id) DO NOTHING;

  SELECT quantity INTO v_prev_balance
  FROM public.product_stocks
  WHERE establishment_id = p_establishment_id AND product_id = p_product_id
  FOR UPDATE;

  v_new_balance := v_prev_balance + p_delta;

  IF NOT COALESCE(v_allow_negative, false) AND v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient stock balance (current: %, delta: %).', v_prev_balance, p_delta;
  END IF;

  UPDATE public.product_stocks
  SET quantity = v_new_balance, updated_at = now()
  WHERE establishment_id = p_establishment_id AND product_id = p_product_id;

  INSERT INTO public.stock_movements(
    company_id, establishment_id, product_id, type, quantity,
    previous_balance, new_balance, unit_cost, origin_document, origin_id,
    user_id, justification
  ) VALUES (
    p_company_id, p_establishment_id, p_product_id, p_type, ABS(p_delta),
    v_prev_balance, v_new_balance, v_cost, p_origin_document, p_origin_id,
    auth.uid(), p_justification
  );

  RETURN v_new_balance;
END;
$$;
