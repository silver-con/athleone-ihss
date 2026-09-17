import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`
  ALTER TABLE caregiver_documents
    ADD COLUMN IF NOT EXISTS signed_via text NOT NULL DEFAULT 'office_recorded',
    ADD COLUMN IF NOT EXISTS envelope_id text
`);
await pool.query(`
  ALTER TABLE caregiver_documents
    DROP CONSTRAINT IF EXISTS caregiver_documents_signed_via_check,
    ADD CONSTRAINT caregiver_documents_signed_via_check CHECK (signed_via IN ('office_recorded', 'docusign'))
`);

await pool.query(`
  ALTER TABLE caregiver_orientations
    ADD COLUMN IF NOT EXISTS signed_via text NOT NULL DEFAULT 'office_recorded',
    ADD COLUMN IF NOT EXISTS envelope_id text
`);
await pool.query(`
  ALTER TABLE caregiver_orientations
    DROP CONSTRAINT IF EXISTS caregiver_orientations_signed_via_check,
    ADD CONSTRAINT caregiver_orientations_signed_via_check CHECK (signed_via IN ('office_recorded', 'docusign'))
`);

console.log('Columns patched — caregiver_documents and caregiver_orientations now match schema.sql.');
await pool.end();
