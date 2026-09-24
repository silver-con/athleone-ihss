// One-off migration for a pre-existing dev database — adds real captured
// EVV clock-in/out timestamps and device geolocation to visits
// (db/schema.sql, "visits" section, 2026-09-22). Every statement here is
// written to be safe to re-run (IF NOT EXISTS throughout), so running this
// twice is a no-op the second time — it will not touch or lose any
// existing data.
//
// Why these columns exist: clockIn()/clockOut() in lib/queries.js used to
// write the literal string 'Just now' into evv_clock_in/evv_clock_out and
// nothing else — no real timestamp, no location, at all. That broke two
// things silently: (1) lib/evv-mapping.js's buildVisitPayload tries to
// parse evv_clock_in as a 12-hour time label ("9:00 AM") to build the
// actual visitStartDateTime/visitEndDateTime the Cures Act requires —
// "Just now" never matches that pattern, so every real (non-fixture)
// visit produced a null actual start/end time and would fail
// validateVisitPayload's "no actual visit start time" check the moment it
// tried to transmit to the state aggregator; (2) there was no location
// capture at all, despite location being one of the six Cures Act
// elements and despite lib/evv-mapping.js's own top comment already
// documenting callLatitude/callLongitude as the intended mapping.
//
// evv_clock_in/evv_clock_out (existing text columns) keep their job as
// the human-readable display label — clockIn()/clockOut() now write a
// real formatted time ("2:47 PM") instead of "Just now". The new columns
// below are the authoritative values: real timestamps buildVisitPayload
// converts directly to UTC (no more guessing from a label), and
// latitude/longitude/accuracy per clock event. All nullable — a
// pre-existing visit, or a clock event where the caregiver's device
// couldn't provide a location, is still recorded rather than blocked.
//
// Run with: npm run db:migrate-2026-09-22-evv-geolocation

const STATEMENTS = [
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_at timestamptz`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_lat double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_lng double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_in_accuracy double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_at timestamptz`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_lat double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_lng double precision`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_clock_out_accuracy double precision`,
];

const EXPECTED_COLUMNS = [
  'evv_clock_in_at',
  'evv_clock_in_lat',
  'evv_clock_in_lng',
  'evv_clock_in_accuracy',
  'evv_clock_out_at',
  'evv_clock_out_lat',
  'evv_clock_out_lng',
  'evv_clock_out_accuracy',
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
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'visits' AND column_name = ANY($1)`,
    [EXPECTED_COLUMNS]
  );
  const found = new Set(check.rows.map((r) => r.column_name));
  const missing = EXPECTED_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    console.error(`Still missing after migration: ${missing.join(', ')}`);
    await pool.end();
    process.exit(1);
  }

  console.log('All 8 columns present on visits.');
  console.log('\nMigration complete. Existing visits keep their old evv_clock_in/evv_clock_out');
  console.log('display text (or NULL) with no real timestamp/location on file — that is');
  console.log('expected for anything clocked in before this change. Every new clock-in/out');
  console.log('going forward captures both.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
