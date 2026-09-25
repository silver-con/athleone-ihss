-- DocuSign Connect webhook: per-agency HMAC secret + last event time.
ALTER TABLE organization_docusign_credentials ADD COLUMN IF NOT EXISTS connect_hmac_key_enc text;
ALTER TABLE organization_docusign_credentials ADD COLUMN IF NOT EXISTS connect_last_event_at timestamptz;
