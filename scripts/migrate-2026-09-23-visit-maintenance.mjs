// One-off migration for a pre-existing dev database — the visit
// maintenance log table and the agency's own maintenance-deadline setting
// (see db/schema.sql, 2026-09-23). Idempotent: safe to re-run.
//
// Run with: npm run db:migrate-2026-09-23-visit-maintenance

const STATEMENTS = [
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS visit_maintenance_window_days integer
     CHECK (visit_maintenance_window_days IS NULL OR (visit_maintenance_window_days >= 1 AND visit_maintenance_window_days <= 365))`,
  `CREATE TABLE IF NOT EXISTS visit_maintenance (
     id                 text PRIMARY KEY,
     organization_id    text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     visit_id           text NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
     kind               text NOT NULL DEFAULT 'maintenance' CHECK (kind IN ('maintenance', 'vmur')),
     contact            text CHECK (contact IS NULL OR contact IN ('none', 'client', 'caregiver', 'substitute')),
     reason_codes       text[] NOT NULL DEFAULT '{}',
     note               text,
     manual_clock_in_at  timestamptz,
     manual_clock_out_at timestamptz,
     payer_reference    text,
     performed_by_user_id text,
     performed_by_name  text NOT NULL,
     performed_by_role  text NOT NULL,
     created_at         timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_visit_maintenance_visit ON visit_maintenance(organization_id, visit_id, created_at)`,
];

async function main() {
  const { pool } = await import('../lib/db.js');
  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.replace(/\s+/g, ' ').slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }
  console.log('\nVerifying...\n');
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'visit_maintenance_window_days'`
  );
  const table = await pool.query(`SELECT to_regclass('public.visit_maintenance') AS t`);
  if (col.rowCount === 0 || !table.rows[0].t) {
    console.error('Migration did not apply cleanly — visit_maintenance table or organizations column missing.');
    await pool.end();
    process.exit(1);
  }
  const open = (await pool.query(
    `SELECT count(*)::int AS n FROM visits WHERE evv_exception IS NOT NULL AND resolved = false`
  )).rows[0].n;
  console.log('visit_maintenance table and organizations.visit_maintenance_window_days present.');
  console.log(`\nMigration complete. ${open} visit(s) have an open exception waiting for maintenance.`);
  console.log('Every agency uses its state\'s window (Texas: 95 days) until an admin sets a shorter');
  console.log('internal deadline on the new Settings page.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
