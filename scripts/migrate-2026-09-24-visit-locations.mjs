// One-off migration for a pre-existing dev database — visit location
// categories and distance-from-home (Vesta "Community Location" parity),
// the client home location, and the agency's "at home" radius setting.
// See db/schema.sql (2026-09-24). Idempotent: safe to re-run.
//
// Run with: npm run db:migrate-2026-09-24-visit-locations

const LOC_CHECK = "IN ('member_home', 'family_home', 'neighbor_home', 'community', 'other')";
const STATEMENTS = [
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS home_radius_feet integer NOT NULL DEFAULT 250 CHECK (home_radius_feet >= 50 AND home_radius_feet <= 2000)`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_lat double precision CHECK (home_lat IS NULL OR (home_lat >= -90 AND home_lat <= 90))`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_lng double precision CHECK (home_lng IS NULL OR (home_lng >= -180 AND home_lng <= 180))`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_location_source text CHECK (home_location_source IS NULL OR home_location_source IN ('learned', 'from_visit', 'entered'))`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_location_set_at timestamptz`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_location_set_by text`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_location text CHECK (evv_clock_in_location IS NULL OR evv_clock_in_location ${LOC_CHECK})`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_location text CHECK (evv_clock_out_location IS NULL OR evv_clock_out_location ${LOC_CHECK})`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_distance_ft double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_distance_ft double precision`,
];

const EXPECTED = {
  organizations: ['home_radius_feet'],
  clients: ['home_lat', 'home_lng', 'home_location_source', 'home_location_set_at', 'home_location_set_by'],
  visits: ['evv_clock_in_location', 'evv_clock_out_location', 'evv_clock_in_distance_ft', 'evv_clock_out_distance_ft'],
};

async function main() {
  const { pool } = await import('../lib/db.js');
  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }
  console.log('\nVerifying...\n');
  const missing = [];
  for (const [table, cols] of Object.entries(EXPECTED)) {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2)`,
      [table, cols]
    );
    const found = new Set(r.rows.map((x) => x.column_name));
    cols.filter((c) => !found.has(c)).forEach((c) => missing.push(`${table}.${c}`));
  }
  if (missing.length > 0) {
    console.error(`Still missing after migration: ${missing.join(', ')}`);
    await pool.end();
    process.exit(1);
  }
  console.log('All columns present.');
  console.log('\nMigration complete. No client has a home location yet: each one is learned from the');
  console.log("first accurate GPS clock-in a caregiver marks as \"Client's home\", or staff can set it");
  console.log("on the client's care-plan page. Past visits show no location category (they predate it).");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
