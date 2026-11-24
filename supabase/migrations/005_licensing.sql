-- ============================================================================
-- MERCATO ERP - Migration 005: Licenciamento (acesso pago liberado pelo ADM)
-- ============================================================================
-- Empresas já existentes continuam ativas (backfill 'active', sem vencimento).
-- Novas empresas nascem 'pending' (sem acesso) até o administrador da
-- plataforma liberar.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS license_status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS license_plan varchar(60),
  ADD COLUMN IF NOT EXISTS license_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_notes text,
  ADD COLUMN IF NOT EXISTS license_updated_at timestamptz;

ALTER TABLE public.companies
  ALTER COLUMN license_status SET DEFAULT 'pending';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_license_status_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_license_status_check
  CHECK (license_status IN ('pending', 'trial', 'active', 'suspended'));

CREATE INDEX IF NOT EXISTS companies_license_idx
  ON public.companies (license_status, license_expires_at);

-- Histórico de liberações, renovações e bloqueios
CREATE TABLE IF NOT EXISTS public.license_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action varchar(40) NOT NULL,
  previous_status varchar(20),
  new_status varchar(20),
  expires_at timestamptz,
  note text,
  created_by_name varchar(160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS license_events_company_idx
  ON public.license_events (company_id, created_at DESC);
ALTER TABLE public.license_events ENABLE ROW LEVEL SECURITY;

-- Proteção do último administrador: não deve impedir a exclusão da própria
-- empresa (a exclusão em cascata de company_users acontece depois que a linha
-- de companies já saiu).
CREATE OR REPLACE FUNCTION public.prevent_removing_last_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF (OLD.role_code = 'admin' AND OLD.status = 'active')
     AND (TG_OP = 'DELETE' OR NEW.role_code <> 'admin' OR NEW.status <> 'active') THEN
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = OLD.company_id) THEN
      RETURN OLD;
    END IF;
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
