// One-off migration for a pre-existing dev database — applies every
// ALTER documented in db/schema.sql's SCHEMA DRIFT WARNING comments from
// the 2026-09-21 multi-state-expansion work (organizations.state,
// generalized provider-identifier columns, organization_evv_credentials
// .aggregator), then verifies the result.
//
// Two of the organizations changes are COLUMN RENAMES
// (texas_medicaid_provider_number -> medicaid_provider_number,
// hcssa_license_number -> state_license_number), which — unlike an ADD
// COLUMN IF NOT EXISTS — aren't naturally idempotent: running "RENAME
// COLUMN x TO y" twice fails the second time because x is already gone.
// This script checks information_schema first and only renames a column
// that's still there under its old name, so it's still safe to re-run.
//
// Run with: npm run db:migrate-2026-09-21-multi-state

async function main() {
  const { pool } = await import('../lib/db.js');

  console.log('Checking current organizations columns...\n');
  const { rows: orgCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations'`
  );
  const have = new Set(orgCols.map((r) => r.column_name));

  const statements = [];

  if (have.has('texas_medicaid_provider_number') && !have.has('medicaid_provider_number')) {
    statements.push([
      'organizations: rename texas_medicaid_provider_number -> medicaid_provider_number',
      `ALTER TABLE organizations RENAME COLUMN texas_medicaid_provider_number TO medicaid_provider_number`,
    ]);
  }
  if (have.has('hcssa_license_number') && !have.has('state_license_number')) {
    statements.push([
      'organizations: rename hcssa_license_number -> state_license_number',
      `ALTER TABLE organizations RENAME COLUMN hcssa_license_number TO state_license_number`,
    ]);
  }

  statements.push([
    'organizations: add state (default TX)',
    `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'TX'`,
  ]);
  statements.push([
    'organization_evv_credentials: add aggregator (default hhaexchange)',
    `ALTER TABLE organization_evv_credentials ADD COLUMN IF NOT EXISTS aggregator text NOT NULL DEFAULT 'hhaexchange'`,
  ]);

  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const [label, sql] of statements) {
    process.stdout.write(`  ${label}... `);
    await pool.query(sql);
    console.log('ok');
  }

  console.log('\nVerifying...\n');
  const problems = [];

  const { rows: finalOrgCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations'`
  );
  const finalHave = new Set(finalOrgCols.map((r) => r.column_name));
  for (const need of ['state', 'medicaid_provider_number', 'state_license_number']) {
    if (!finalHave.has(need)) problems.push(`organizations.${need} still missing`);
  }
  if (finalHave.has('texas_medicaid_provider_number')) {
    problems.push('organizations.texas_medicaid_provider_number still present (rename did not complete)');
  }
  if (finalHave.has('hcssa_license_number')) {
    problems.push('organizations.hcssa_license_number still present (rename did not complete)');
  }

  const { rows: evvCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'organization_evv_credentials' AND column_name = 'aggregator'`
  );
  if (evvCols.length === 0) problems.push('organization_evv_credentials.aggregator still missing');

  await pool.end();

  if (problems.length) {
    console.error('Migration ran but verification found gaps:\n' + problems.map((p) => '  ✗ ' + p).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(
    'All clear — organizations.state/medicaid_provider_number/state_license_number and ' +
    'organization_evv_credentials.aggregator are all present. Existing rows default to TX / hhaexchange, ' +
    'matching every current tenant.'
  );
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
});
