-- Email/SMS outbox and per-agency notification settings (2026-09-25).
-- See db/schema.sql's notifications table and organizations columns.
CREATE TABLE IF NOT EXISTS notifications (
  id                  text PRIMARY KEY,
  organization_id     text REFERENCES organizations(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient           text NOT NULL,
  template            text NOT NULL,
  subject             text,
  body                text,
  provider            text NOT NULL,
  status              text NOT NULL CHECK (status IN ('logged', 'sending', 'sent', 'delivered', 'undelivered', 'failed')),
  provider_message_id text,
  error               text,
  user_id             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_org_created ON notifications(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_provider_msg ON notifications(provider_message_id);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_email text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS caregiver_notify_channel text NOT NULL DEFAULT 'sms';
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_caregiver_notify_channel_check
    CHECK (caregiver_notify_channel IN ('sms', 'email', 'both', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
