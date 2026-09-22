// One-off migration for a pre-existing dev database — adds the tenant-side
// audit_log table (db/schema.sql's "TENANT-SIDE AUDIT TRAIL" section,
// 2026-09-22). Every statement here is written to be safe to re-run
// (IF NOT EXISTS throughout), so running this twice is a no-op the second
// time — it will not touch or lose any existing data.
//
// Run with: npm run db:migrate-2026-09-22-audit-log

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS audit_log (
     id              text PRIMARY KEY,
     organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     actor_user_id   text REFERENCES users(id) ON DELETE SET NULL,
     actor_name      text NOT NULL,
     actor_role      text NOT NULL,
     location_id     text REFERENCES locations(id) ON DELETE SET NULL,
     action          text NOT NULL,
     entity_type     text NOT NULL,
     entity_id       text,
     detail          text,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(organization_id, created_at DESC)`,
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
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_log'`
  );
  const expected = [
    'id', 'organization_id', 'actor_user_id', 'actor_name', 'actor_role',
    'location_id', 'action', 'entity_type', 'entity_id', 'detail', 'created_at',
  ];
  const found = new Set(check.rows.map((r) => r.column_name));
  const missing = expected.filter((c) => !found.has(c));
  if (missing.length) {
    console.error(`Missing columns on audit_log: ${missing.join(', ')}`);
    await pool.end();
    process.exit(1);
  }

  console.log('audit_log table present with all expected columns.');
  console.log('\nMigration complete.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
