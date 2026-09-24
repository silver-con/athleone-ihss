// One-off migration for a pre-existing dev database — downward bill-hours
// adjustments (HHSC reason code 110 B) recorded on the visit and in the
// visit maintenance log (see db/schema.sql, 2026-09-24). Idempotent.
//
// Run with: npm run db:migrate-2026-09-24-bill-hours

const STATEMENTS = [
  `ALTER TABLE visits ADD COLUMN IF NOT EXISTS bill_minutes integer CHECK (bill_minutes IS NULL OR bill_minutes > 0)`,
  `ALTER TABLE visit_maintenance ADD COLUMN IF NOT EXISTS bill_minutes_before integer`,
  `ALTER TABLE visit_maintenance ADD COLUMN IF NOT EXISTS bill_minutes_after integer`,
];

async function main() {
  const { pool } = await import('../lib/db.js');
  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }
  const r = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'visits' AND column_name = 'bill_minutes')
         OR (table_name = 'visit_maintenance' AND column_name IN ('bill_minutes_before', 'bill_minutes_after'))`
  );
  if (r.rowCount !== 3) {
    console.error('Migration did not apply cleanly — bill-hours columns missing.');
    await pool.end();
    process.exit(1);
  }
  console.log('\nAll 3 columns present. Existing visits keep billing their scheduled duration.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
