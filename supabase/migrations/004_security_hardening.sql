-- ============================================================================
-- MERCATO ERP - Migration 004: Cybersecurity Hardening (Session Revocation)
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_valid_after timestamptz NOT NULL DEFAULT now();
