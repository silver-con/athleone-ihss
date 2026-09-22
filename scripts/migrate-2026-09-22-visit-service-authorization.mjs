// One-off migration for a pre-existing dev database — adds
// visits.service_authorization_id (db/schema.sql, "visits" section,
// 2026-09-22). Every statement here is written to be safe to re-run
// (IF NOT EXISTS throughout), so running this twice is a no-op the second
// time — it will not touch or lose any existing data.
//
// Why this column exists: generateBillingLineForVisit used to always guess
// which of a client's (potentially several) concurrently-approved service
// authorizations a visit was for, via getActiveAuthorization's
// `ORDER BY end_date DESC, created_at DESC` tiebreak — essentially
// arbitrary/timing-dependent whenever a client has more than one active
// authorization (PAS attendant care + a separate Respite authorization, for
// instance). This column lets the "Schedule a visit" form capture the
// correct choice up front instead, so billing never has to guess. See
// claude/deferred-backlog.md for the full writeup.
//
// Run with: npm run db:migrate-2026-09-22-visit-service-authorization

const STATEMENTS = [
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS service_authorization_id text REFERENCES service_authorizations(id) ON DELETE SET NULL`,
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
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'visits' AND column_name = 'service_authorization_id'`
  );
  if (check.rows.length !== 1) {
    console.error('visits.service_authorization_id is missing after migration.');
    await pool.end();
    process.exit(1);
  }

  console.log('visits.service_authorization_id present.');
  console.log('\nMigration complete. Existing visits are left with a NULL pick — billing for');
  console.log('those still falls back to the old best-effort guess, same as before this change.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
