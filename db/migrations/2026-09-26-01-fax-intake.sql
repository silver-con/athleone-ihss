-- Fax / document intake with OCR extraction and human review (2026-09-26).
CREATE TABLE IF NOT EXISTS incoming_documents (
  id                  text PRIMARY KEY,
  organization_id     text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source              text NOT NULL CHECK (source IN ('upload', 'fax', 'sample')),
  status              text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'needs_review', 'approved', 'rejected', 'failed')),
  file_key            text NOT NULL,
  file_name           text,
  mime_type           text NOT NULL,
  file_size           integer NOT NULL,
  sha256              text NOT NULL,
  page_count          integer,
  sender              text,
  engine              text,
  doc_type            text,
  extraction          jsonb,
  raw_text            text,
  error               text,
  referral_id         text REFERENCES referrals(id) ON DELETE SET NULL,
  uploaded_by_user_id text,
  reviewed_by_user_id text,
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  reject_reason       text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_incoming_docs_org_status ON incoming_documents(organization_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_incoming_docs_sha ON incoming_documents(organization_id, sha256);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fax_number text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fax_webhook_token_hash text;
