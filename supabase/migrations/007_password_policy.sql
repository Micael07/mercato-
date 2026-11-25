-- ============================================================================
-- MERCATO ERP - Migration 007: troca de senha obrigatória e recuperação sem e-mail
-- ============================================================================
-- Recuperação: o usuário informa e-mail + CPF + nome completo + data de nascimento.
-- Nada disso é guardado em claro: só um HMAC (recovery_hash) dos três dados.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_hash text,
  ADD COLUMN IF NOT EXISTS recovery_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE public.user_requests
  ADD COLUMN IF NOT EXISTS recovery_hash text;
