// Points one tenant's EVV credentials at the local HHAeXchange mock
// (mocks/hhaexchange-mock.mjs, `npm run mock:evv`) so the complete EVV
// pipeline — visit clock-out, queue, transmit, poll, acknowledge, billing
// draft on acknowledgment — can be exercised end-to-end through the real
// app and real UI, while the real HHAeXchange sandbox credentials are
// still blocked on VSTAR's onboarding submission (see
// claude/deferred-backlog.md's Integrations section).
//
// This is a demo/QA convenience only. It does not change any application
// source file: it just writes a row to organization_evv_credentials, the
// same table the existing /admin/evv/sync "Credentials" form writes to,
// using the same lib/db.upsertEvvCredentials + lib/secrets.encryptSecret
// that form's Server Action already uses. Nothing about lib/hhaexchange.js,
// lib/evv-sync.js, or lib/evv-mapping.js changes or needs to — they are
// already pure HTTP against whatever api_base_url is stored, which is the
// whole point of mocks/hhaexchange-mock.mjs's own header comment:
// "Pointing Hearth at the real sandbox later is a change of base URL and
// credentials, not a change of code."
//
// The one thing no existing UI or action can do is set status to 'live'
// (that transition is a deliberate manual/administrative step everywhere
// else in the app — see actions/evv.js). This script can, so you can see
// the FULL pipeline (billing drafted only on EVV acknowledgment) rather
// than the pre-certification fallback (billing drafted immediately at
// clock-out). Pass --status=testing or --status=passed for a lower rung
// if you want to demo the fallback behavior instead.
//
// Run with (mock server must be running separately — see the printed
// instructions at the end):
//   npm run evv:sandbox-demo -- --org="Sunrise Home Care"
//   npm run evv:sandbox-demo -- --org=org_abc123 --port=4010 --status=live
//
// To go back to real HHAeXchange credentials later, just re-save them
// through the existing /admin/evv/sync credentials form — no script, no
// code change, same as always.
import { randomUUID } from 'crypto';
import { pool, queryOne, query } from '../lib/db.js';
import { encryptSecret } from '../lib/secrets.js';

const STATUSES = ['testing', 'passed', 'live'];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function findOrganization(orgArg) {
  const byId = await queryOne('SELECT id, name FROM organizations WHERE id = $1', [orgArg]);
  if (byId) return byId;

  const byName = await query('SELECT id, name FROM organizations WHERE name ILIKE $1', [`%${orgArg}%`]);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    console.error(`"${orgArg}" matches more than one organization — be more specific, or pass the id:`);
    byName.forEach((o) => console.error(`  ${o.id}  ${o.name}`));
    process.exit(1);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgArg = String(args.org || '').trim();
  const port = String(args.port || process.env.MOCK_EVV_PORT || '4010').trim();
  const status = String(args.status || 'live').trim();
  const providerTaxId = String(args['tax-id'] || '00-0000000').trim();
  const officeIdentifier = String(args['office-id'] || '1234567893').trim();
  const payerId = String(args['payer-id'] || 'TX-MEDICAID').trim();
  const officeQualifier = String(args['office-qualifier'] || 'NPI').trim();

  if (!orgArg) {
    console.error(
      'Usage: npm run evv:sandbox-demo -- --org="Agency Name or id" [--port=4010] [--status=testing|passed|live]'
    );
    process.exit(1);
  }
  if (!STATUSES.includes(status)) {
    console.error(`--status must be one of: ${STATUSES.join(', ')}`);
    process.exit(1);
  }

  const org = await findOrganization(orgArg);
  if (!org) {
    console.error(`No organization found matching "${orgArg}". Organizations on file:`);
    const all = await query('SELECT id, name FROM organizations ORDER BY name', []);
    all.forEach((o) => console.error(`  ${o.id}  ${o.name}`));
    process.exit(1);
  }

  const apiBaseUrl = `http://localhost:${port}`;

  await query(
    `INSERT INTO organization_evv_credentials
       (organization_id, api_base_url, api_version, client_id_enc, client_secret_enc, scope,
        provider_tax_id, office_qualifier, office_identifier, payer_id, environment, aggregator, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (organization_id) DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url, api_version = EXCLUDED.api_version,
       client_id_enc = EXCLUDED.client_id_enc, client_secret_enc = EXCLUDED.client_secret_enc,
       scope = EXCLUDED.scope, provider_tax_id = EXCLUDED.provider_tax_id,
       office_qualifier = EXCLUDED.office_qualifier, office_identifier = EXCLUDED.office_identifier,
       payer_id = EXCLUDED.payer_id, environment = EXCLUDED.environment,
       aggregator = EXCLUDED.aggregator, status = EXCLUDED.status`,
    [
      org.id,
      apiBaseUrl,
      '1',
      encryptSecret('sandbox-demo-client'),
      encryptSecret(`sandbox-demo-secret-${randomUUID().slice(0, 8)}`),
      null,
      providerTaxId,
      officeQualifier,
      officeIdentifier,
      payerId,
      'sandbox',
      'hhaexchange',
      status,
    ]
  );

  console.log(`\nPointed "${org.name}" (${org.id}) at the local EVV mock.`);
  console.log(`  api_base_url: ${apiBaseUrl}`);
  console.log(`  status:       ${status}`);
  console.log('\nNext steps:');
  console.log('  1. In one terminal:  npm run mock:evv' + (port !== '4010' ? `   (set MOCK_EVV_PORT=${port} first if you changed --port)` : ''));
  console.log('  2. In another:       npm run dev');
  console.log('  3. Sign in as an admin for this agency, clock a visit in and out as a caregiver,');
  console.log('     then visit /admin/evv/sync and click "Run sync" — you\'ll see it queue, transmit,');
  console.log('     go Pending, then resolve to acknowledged (the mock deliberately holds transactions');
  console.log('     "Pending" for ~1.2s so the poll/retry path actually exercises, not just the happy path).');
  if (status === 'live') {
    console.log('     Because status is "live", the billing line for that visit is drafted only once the');
    console.log('     mock acknowledges the visit — not immediately at clock-out. Check /admin/billing after syncing.');
  }
  console.log('\nTo test the failure path: create a visit whose id happens not to matter — instead the');
  console.log('mock fails any externalVisitID ending in "-fail" and rejects client_id "bad-client".');
  console.log('\nWhen the real HHAeXchange sandbox credentials arrive, just re-save them through the');
  console.log('existing /admin/evv/sync credentials form — this script does not need to be run again,');
  console.log('and nothing here changes how that form or the real adapter work.\n');

  await pool.end();
}

main().catch(async (err) => {
  console.error('Failed to configure the EVV sandbox demo:', err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
