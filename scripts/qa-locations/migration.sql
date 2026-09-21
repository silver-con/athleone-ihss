-- The exact statements handed to the user, verbatim from db/schema.sql's
-- SCHEMA DRIFT WARNING comment block.
CREATE TABLE IF NOT EXISTS locations (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE service_authorizations ADD COLUMN IF NOT EXISTS rate_per_unit numeric;
CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_location ON caregivers(location_id);
CREATE INDEX IF NOT EXISTS idx_clients_location ON clients(location_id);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_id);
