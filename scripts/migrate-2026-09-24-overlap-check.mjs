// One-off migration for a pre-existing dev database — the agency's
// distance threshold for the overlapping-visit check (see db/schema.sql,
// organizations, 2026-09-24). Idempotent: safe to re-run.
//
// Run with: npm run db:migrate-2026-09-24-overlap-check

async function main() {
  const { pool } = await import('../lib/db.js');
  const sql = `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS overlap_distance_feet integer NOT NULL DEFAULT 100 CHECK (overlap_distance_feet >= 25 AND overlap_distance_feet <= 1000)`;
  process.stdout.write(`  ${sql.slice(0, 70)}... `);
  await pool.query(sql);
  console.log('ok');
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'overlap_distance_feet'`
  );
  if (r.rowCount !== 1) {
    console.error('Migration did not apply cleanly — organizations.overlap_distance_feet missing.');
    await pool.end();
    process.exit(1);
  }
  console.log('\norganizations.overlap_distance_feet present (default 100 ft). Existing visits are');
  console.log('checked the next time they are queued or viewed on the EVV Export page.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
