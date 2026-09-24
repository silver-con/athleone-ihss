// One-off migration for a pre-existing dev database — adds the EVV member
// identity columns to `clients` (see db/schema.sql, clients table,
// 2026-09-23) and backfills date_of_birth from each client's original
// referral where that date is readable. Every statement is idempotent
// (IF NOT EXISTS throughout, backfill only touches NULLs), so running this
// twice is a no-op the second time.
//
// Why: the Texas EVV aggregator identifies the member by their 9-digit
// Medicaid ID. Hearth had no column for it — the intake form collected
// "Member / Medicaid ID" and date of birth but submitIntake() dropped both,
// and lib/evv-mapping.js sent Hearth's internal client id as the MedicaidID
// instead, which the aggregator would reject. See the project doc
// vesta-guides-production-gap-list.md, "Blockers" item 1.
//
// Medicaid IDs are NOT backfilled — nothing trustworthy to copy from.
// Staff enter them on each client's care-plan page (EVV identity card).
//
// Run with: npm run db:migrate-2026-09-23-client-evv-identity

import { normalizeDob } from '../lib/client-identity.js';

const STATEMENTS = [
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS medicaid_id text CHECK (medicaid_id IS NULL OR medicaid_id ~ '^[0-9]{9}$')`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_of_birth text CHECK (date_of_birth IS NULL OR date_of_birth ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_line1 text`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS city text`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS state text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$')`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS zip text CHECK (zip IS NULL OR zip ~ '^[0-9]{5}(-[0-9]{4})?$')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_org_medicaid_id ON clients(organization_id, medicaid_id) WHERE medicaid_id IS NOT NULL`,
];

const EXPECTED_COLUMNS = ['medicaid_id', 'date_of_birth', 'address_line1', 'city', 'state', 'zip'];

async function main() {
  const { pool } = await import('../lib/db.js');

  console.log('Applying migration (every statement is idempotent — safe even if already partially applied)...\n');
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.slice(0, 70)}... `);
    await pool.query(sql);
    console.log('ok');
  }

  console.log('\nVerifying...\n');
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'clients' AND column_name = ANY($1)`,
    [EXPECTED_COLUMNS]
  );
  const found = new Set(check.rows.map((r) => r.column_name));
  const missing = EXPECTED_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    console.error(`Still missing after migration: ${missing.join(', ')}`);
    await pool.end();
    process.exit(1);
  }
  console.log(`All ${EXPECTED_COLUMNS.length} columns present on clients.`);

  console.log('\nBackfilling date_of_birth from each client\'s original referral...\n');
  const rows = (
    await pool.query(
      `SELECT c.id, c.organization_id, r.dob
         FROM clients c JOIN referrals r ON r.id = c.from_referral_id AND r.organization_id = c.organization_id
        WHERE c.date_of_birth IS NULL`
    )
  ).rows;
  let filled = 0;
  const skipped = [];
  for (const row of rows) {
    let iso = null;
    try {
      iso = normalizeDob(row.dob);
    } catch {
      iso = null;
    }
    if (!iso) {
      skipped.push(`${row.id} (referral DOB "${row.dob}")`);
      continue;
    }
    await pool.query(
      'UPDATE clients SET date_of_birth = $1 WHERE organization_id = $2 AND id = $3 AND date_of_birth IS NULL',
      [iso, row.organization_id, row.id]
    );
    filled += 1;
  }
  console.log(`  filled ${filled} of ${rows.length} client(s) that had no date of birth.`);
  if (skipped.length > 0) {
    console.log('  could not read these referral dates — enter the DOB by hand on the care-plan page:');
    skipped.forEach((s) => console.log(`    - ${s}`));
  }

  const noMedicaid = (await pool.query('SELECT count(*)::int AS n FROM clients WHERE medicaid_id IS NULL')).rows[0].n;
  console.log(`\nMigration complete. ${noMedicaid} client(s) have no Medicaid ID yet — their EVV`);
  console.log('visits will be held back from the aggregator (with a readable reason on /admin/evv)');
  console.log('until someone enters it on the client\'s care-plan page.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
