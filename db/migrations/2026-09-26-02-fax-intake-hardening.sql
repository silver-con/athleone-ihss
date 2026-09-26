-- Fax Inbox hardening (2026-09-26, after review):
--  * processing_started_at: a read interrupted by a server restart is left
--    in "processing"; after 10 minutes staff can retry or reject it.
--  * one live copy of a file per agency, enforced by the database, so two
--    simultaneous deliveries of the same fax can't create two rows.
ALTER TABLE incoming_documents ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
DROP INDEX IF EXISTS idx_incoming_docs_sha;
CREATE UNIQUE INDEX IF NOT EXISTS idx_incoming_docs_sha_live ON incoming_documents(organization_id, sha256) WHERE status <> 'rejected';
