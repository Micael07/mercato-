-- Migração 010: vendas feitas offline no PDV (identificador do aparelho evita duplicar ao sincronizar).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_ref varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref_uidx ON public.sales (company_id, client_ref) WHERE client_ref IS NOT NULL;
