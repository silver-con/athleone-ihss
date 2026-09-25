-- Office Messages inbox (2026-09-25): read receipts, who replied, and
-- whether a message came in by text.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by_office_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by_caregiver_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_source_check CHECK (source IN ('app', 'sms'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_messages_org_caregiver ON messages(organization_id, caregiver_id, created_at);
-- Everything already in a thread counts as read, so no one opens the new
-- inbox to a wall of old "unread" messages.
UPDATE messages SET read_by_office_at = COALESCE(read_by_office_at, created_at) WHERE mine = true;
UPDATE messages SET read_by_caregiver_at = COALESCE(read_by_caregiver_at, created_at) WHERE mine = false;
