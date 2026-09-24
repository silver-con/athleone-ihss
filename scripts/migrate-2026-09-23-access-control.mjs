// One-off migration for a pre-existing dev database — account lifecycle
// columns on `users` plus the `login_attempts` table (see db/schema.sql,
// users table, 2026-09-23 access-control pass). Idempotent: safe to re-run.
//
// must_change_password is added with DEFAULT false so EXISTING accounts are
// not forced through a password change by this migration, then the default
// is switched to true so every account created from now on must replace
// its starting password at first sign-in.
//
// Run with: npm run db:migrate-2026-09-23-access-control

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false`,
  `ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     email          text PRIMARY KEY,
     failed_count   integer NOT NULL DEFAULT 0,
     locked_until   timestamptz,
     last_failed_at timestamptz
   )`,
];

const EXPECTED_COLUMNS = ['active', 'session_version', 'must_change_password', 'password_changed_at', 'last_login_at', 'deactivated_at'];

async function main() {
  const { pool } = await import('../lib/db.js');

  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.replace(/\s+/g, ' ').slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }

  console.log('\nVerifying...\n');
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = ANY($1)`,
    [EXPECTED_COLUMNS]
  );
  const found = new Set(cols.rows.map((r) => r.column_name));
  const missing = EXPECTED_COLUMNS.filter((c) => !found.has(c));
  const table = await pool.query(`SELECT to_regclass('public.login_attempts') AS t`);
  if (missing.length > 0 || !table.rows[0].t) {
    console.error(`Still missing after migration: ${[...missing, ...(table.rows[0].t ? [] : ['login_attempts table'])].join(', ')}`);
    await pool.end();
    process.exit(1);
  }
  const counts = (await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE must_change_password)::int AS forced FROM users`
  )).rows[0];
  console.log(`All ${EXPECTED_COLUMNS.length} columns present on users, and login_attempts exists.`);
  console.log(`\nMigration complete. ${counts.total} existing account(s) stay active and are NOT forced to`);
  console.log(`change their password (${counts.forced} currently flagged). Accounts created from now on`);
  console.log('must set their own password at first sign-in.');
  console.log('\nNote: everyone currently signed in will be signed out once the new code is');
  console.log('running (their session predates the session-version check). That is expected.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
