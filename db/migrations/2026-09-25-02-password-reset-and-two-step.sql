-- Forgot-password links and two-step sign-in codes (2026-09-25).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              text PRIMARY KEY,
  token_hash      text NOT NULL UNIQUE,
  account_kind    text NOT NULL CHECK (account_kind IN ('user', 'platform')),
  account_id      text NOT NULL,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_account ON password_reset_tokens(account_kind, account_id);

CREATE TABLE IF NOT EXISTS sign_in_challenges (
  id              text PRIMARY KEY,
  account_kind    text NOT NULL CHECK (account_kind IN ('user', 'platform')),
  account_id      text NOT NULL,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash       text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination     text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  next_path       text,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sign_in_challenges_account ON sign_in_challenges(account_kind, account_id, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method text NOT NULL DEFAULT 'off';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_phone text;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_two_factor_method_check CHECK (two_factor_method IN ('off', 'email', 'sms'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS require_two_factor boolean NOT NULL DEFAULT false;
