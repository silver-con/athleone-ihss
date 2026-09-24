// One-off migration for a pre-existing dev database — the office "hold"
// on sending a visit to the state EVV aggregator (see db/schema.sql,
// visits, 2026-09-24). Idempotent: safe to re-run.
//
// Run with: npm run db:migrate-2026-09-24-evv-export-hold

const STATEMENTS = [
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_export_hold boolean NOT NULL DEFAULT false`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_export_hold_reason text`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_export_hold_by text`,
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS evv_export_hold_at timestamptz`,
];
const EXPECTED = ['evv_export_hold', 'evv_export_hold_reason', 'evv_export_hold_by', 'evv_export_hold_at'];

async function main() {
  const { pool } = await import('../lib/db.js');
  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'visits' AND column_name = ANY($1)`,
    [EXPECTED]
  );
  if (r.rowCount !== EXPECTED.length) {
    console.error('Migration did not apply cleanly — hold columns missing on visits.');
    await pool.end();
    process.exit(1);
  }
  console.log('\nAll 4 columns present on visits. No visit is on hold; nothing changes until someone');
  console.log('holds a visit on the new EVV Export page.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
