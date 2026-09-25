-- Review fixes (2026-09-25): platform-admin session versions (a password
-- reset signs out every session) and de-duplication of inbound texts.
ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL;
