-- Migração 009: validade no produto e relatórios salvos (favoritos).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS expiry_date date;
CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products (company_id, expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  report_type varchar(40) NOT NULL,
  period varchar(20) NOT NULL DEFAULT '30d',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_reports_user_idx ON public.saved_reports (company_id, user_id);
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
