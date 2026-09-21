// One-off migration for a pre-existing dev database — applies every ALTER
// documented in db/schema.sql's SCHEMA/CONSTRAINT DRIFT WARNING comments
// from the 2026-09-17 locations/three-tier work, then verifies the result.
// Every statement here is written to be safe to re-run (IF NOT EXISTS /
// DROP + ADD for constraints), so running this twice is a no-op the second
// time — it will not touch or lose any existing data.
//
// Run with: npm run db:migrate-2026-09-17

const STATEMENTS = [
  // organizations — provider-enrollment / BAA attestation columns
  `ALTER TABLE organizations
     ADD COLUMN IF NOT EXISTS provider_enrollment_attested boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS baa_signed boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS baa_signed_at timestamptz`,

  // locations table + the four columns/indexes that reference it
  `CREATE TABLE IF NOT EXISTS locations (
     id              text PRIMARY KEY,
     organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     name            text NOT NULL,
     commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
     status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL`,
  `ALTER TABLE service_authorizations ADD COLUMN IF NOT EXISTS rate_per_unit numeric`,
  `CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id)`,
  `CREATE INDEX IF NOT EXISTS idx_caregivers_location ON caregivers(location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clients_location ON clients(location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_id)`,

  // users.role CHECK constraint — add LOCATION_ADMIN
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
  `ALTER TABLE users ADD CONSTRAINT users_role_check
     CHECK (role IN ('COORDINATOR', 'ADMIN', 'LOCATION_ADMIN', 'CAREGIVER'))`,

  // platform_admins — active flag + support/full sub-role
  `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
  `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'full'`,
  `ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_platform_role_check`,
  `ALTER TABLE platform_admins ADD CONSTRAINT platform_admins_platform_role_check
     CHECK (platform_role IN ('support', 'full'))`,
];

async function main() {
  const { pool } = await import('../lib/db.js');

  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    const label = sql.trim().split('\n')[0].slice(0, 70);
    process.stdout.write(`  ${label}... `);
    await pool.query(sql);
    console.log('ok');
  }

  console.log('\nVerifying...\n');
  const problems = [];

  const locTable = await pool.query(`SELECT to_regclass('public.locations') AS t`);
  if (!locTable.rows[0].t) problems.push('locations table still missing');

  const cols = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name = 'caregivers' AND column_name = 'location_id')
       OR (table_name = 'clients' AND column_name = 'location_id')
       OR (table_name = 'users' AND column_name = 'location_id')
       OR (table_name = 'service_authorizations' AND column_name = 'rate_per_unit')
       OR (table_name = 'platform_admins' AND column_name IN ('active', 'platform_role'))
  `);
  const have = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
  for (const need of [
    'caregivers.location_id', 'clients.location_id', 'users.location_id',
    'service_authorizations.rate_per_unit', 'platform_admins.active', 'platform_admins.platform_role',
  ]) {
    if (!have.has(need)) problems.push(`${need} still missing`);
  }

  const roleCheck = await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check'`);
  if (!roleCheck.rows[0] || !roleCheck.rows[0].def.includes('LOCATION_ADMIN')) {
    problems.push('users_role_check does not yet allow LOCATION_ADMIN');
  }

  await pool.end();

  if (problems.length) {
    console.error('Migration ran but verification found gaps:\n' + problems.map((p) => '  ✗ ' + p).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('All clear — locations, the four location/rate columns, the LOCATION_ADMIN role, and the platform-admin sub-role columns are all present.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
});
