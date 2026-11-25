-- Migração 008: cadastro completo do usuário visível ao ADM da plataforma.
-- CPF e nascimento ficam criptografados (AES-256-GCM, chave derivada do AUTH_SECRET).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_enc text;
ALTER TABLE public.user_requests ADD COLUMN IF NOT EXISTS profile_enc text;
