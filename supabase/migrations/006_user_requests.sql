-- ============================================================================
-- MERCATO ERP - Migration 006: Solicitação e autorização de usuários
-- ============================================================================
-- O administrador da empresa não convida mais por link: ele cadastra os dados
-- do colaborador (solicitação). A autorização é do ADM da plataforma ou, se
-- ele permitir, do próprio administrador da empresa, dentro do limite de
-- usuários definido pelo ADM da plataforma.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_users integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS user_approval_mode varchar(20) NOT NULL DEFAULT 'platform';

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_user_approval_mode_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_user_approval_mode_check
  CHECK (user_approval_mode IN ('platform', 'company'));
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_max_users_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_max_users_check
  CHECK (max_users >= 1 AND max_users <= 1000);

-- Empresas existentes: limite inicial = usuários ativos atuais (mínimo 3),
-- para nada quebrar. O ADM da plataforma ajusta depois.
UPDATE public.companies c
   SET max_users = GREATEST(3, (SELECT count(*) FROM public.company_users cu
                                 WHERE cu.company_id = c.id AND cu.status = 'active'));

CREATE TABLE IF NOT EXISTS public.user_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  email varchar(180) NOT NULL,
  phone varchar(30),
  role_code varchar(40) NOT NULL DEFAULT 'cashier',
  notes text,
  status varchar(20) NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_by_name varchar(160),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_by_name varchar(160),
  decided_at timestamptz,
  decision_note text,
  created_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT user_requests_role_check CHECK (role_code IN ('admin', 'manager', 'cashier', 'stockist'))
);
CREATE INDEX IF NOT EXISTS user_requests_company_idx
  ON public.user_requests (company_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_requests_pending_email_uidx
  ON public.user_requests (company_id, lower(email)) WHERE status = 'pending';
ALTER TABLE public.user_requests ENABLE ROW LEVEL SECURITY;
