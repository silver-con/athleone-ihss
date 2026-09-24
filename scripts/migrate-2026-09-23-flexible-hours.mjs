// One-off migration for a pre-existing dev database — adds the first two
// entries of the per-organization "configurator" settings surface
// (db/schema.sql, "organizations" section, 2026-09-23): flexible-hours
// mode and its grace-period-past-scheduled-end value. Every statement
// here is written to be safe to re-run (IF NOT EXISTS throughout), so
// running this twice is a no-op the second time — it will not touch or
// lose any existing data.
//
// Why these columns exist: the agency told the user directly that a
// caregiver's actual clock-in/out times don't have to match the
// scheduled visit window exactly — what matters is completing the full
// scheduled/authorized hours within the same day (e.g. a 6AM-12PM visit
// clocked 8AM-2PM is fine). Hearth had zero logic comparing actual clock
// times to the schedule at all before this. The user then confirmed this
// should be a per-organization setting (not a single hardcoded app-wide
// behavior) with a specific tunable: a grace period, in minutes, past the
// visit's SCHEDULED END time — a clock-out inside that window is clean, a
// clock-out later than that raises Texas reason code 110A ("Service
// Delivery Exception — schedule variance", already defined in
// lib/state-compliance.js) for office review via the existing
// resolveVisitException flow. See the project doc
// vesta-evv-feature-reference.md's "Made configurable, per-organization"
// section for the full research/reasoning trail, and its "Full
// Configurator candidate-settings assessment" section for the many other
// settings expected to join this same table over time (this is
// deliberately the FIRST entry, not the only one).
//
// Defaults: flexible_hours_enabled defaults to FALSE (opt-in per org) even
// though the org that prompted this wants it on — deliberately, because
// lib/data.js's WEEK_DAYS/TODAY_ISO are a fixed demo reference week
// (2026-09-14 through 2026-09-20), not the real rolling calendar date.
// Every visit scheduled through createVisit() today already has a
// "scheduled end" that's in the past by the time it's clocked out in real
// time, so turning this on by default would flag nearly every real
// clock-out as an exception — a false-positive flood, not a working
// feature. grace_minutes still defaults to 20 (harmless while disabled).
// Enable per-org (there's no settings UI yet — see updateOrganizationFlexibleHours
// in lib/queries.js) only once WEEK_DAYS reflects real dates, or for a
// visit whose schedule was deliberately set far enough in the future to
// test against.
//
// Run with: npm run db:migrate-2026-09-23-flexible-hours

const STATEMENTS = [
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS flexible_hours_enabled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS flexible_hours_grace_minutes integer NOT NULL DEFAULT 20 CHECK (flexible_hours_grace_minutes >= 0 AND flexible_hours_grace_minutes <= 480)`,
];

const EXPECTED_COLUMNS = ['flexible_hours_enabled', 'flexible_hours_grace_minutes'];

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
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = ANY($1)`,
    [EXPECTED_COLUMNS]
  );
  const found = new Set(check.rows.map((r) => r.column_name));
  const missing = EXPECTED_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    console.error(`Still missing after migration: ${missing.join(', ')}`);
    await pool.end();
    process.exit(1);
  }

  console.log('Both columns present on organizations.');
  console.log('\nMigration complete. Every existing organization now has flexible_hours_enabled');
  console.log('= false (grace_minutes defaults to 20, but is inert while disabled) — nobody');
  console.log('sees any behavior change from this alone. To turn it on for a specific org,');
  console.log('run: UPDATE organizations SET flexible_hours_enabled = true WHERE id = \'...\';');
  console.log('(there is no settings UI yet). See the migration file\'s own header comment');
  console.log('for why the default is off — lib/data.js\'s WEEK_DAYS is a fixed demo week,');
  console.log('not the real rolling date, so enabling this before that\'s fixed will flag');
  console.log('nearly every real clock-out as a schedule-variance exception.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
