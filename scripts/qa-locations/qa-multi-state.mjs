// QA for the 2026-09-21 multi-state-expansion base configuration:
// organizations.state + generalized provider-identifier columns, the
// per-state compliance profile registry (lib/state-compliance.js), and
// the EVV reason-code translation it now feeds (lib/evv-mapping.js).
//
// Runs the REAL lib/queries.js functions against the throwaway QA
// database, same as the other suites here — see run-qa.sh.
import * as db from './queries.js';
import { query, pool } from './db.js';
import { getComplianceProfile, getAggregatorReasonMap } from './state-compliance.js';
import { buildVisitPayload } from './evv-mapping.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

async function run() {
  console.log('\n== organizations.state + renamed provider-identifier columns ==');

  const created = await db.createOrganizationWithAdmin({
    organizationName: 'California Test Agency',
    adminName: 'Cal Admin',
    email: 'cal-admin@x.test',
    passwordHash: 'x',
    state: 'CA',
    medicaidProviderNumber: 'CA-MPN-1',
    npi: '1234567890',
    stateLicenseNumber: 'CA-LIC-1',
  });
  const caOrg = await db.getOrganization(created.organizationId);
  eq('state round-trips through createOrganizationWithAdmin -> getOrganization', caOrg.state, 'CA');
  eq('medicaidProviderNumber round-trips (renamed from texasMedicaidProviderNumber)', caOrg.medicaidProviderNumber, 'CA-MPN-1');
  eq('stateLicenseNumber round-trips (renamed from hcssaLicenseNumber)', caOrg.stateLicenseNumber, 'CA-LIC-1');

  const defaultedOrg = await db.createOrganizationWithAdmin({
    organizationName: 'No State Given Agency',
    adminName: 'Default Admin',
    email: 'default-admin@x.test',
    passwordHash: 'x',
  });
  const defaulted = await db.getOrganization(defaultedOrg.organizationId);
  eq('omitting state defaults to TX (every pre-existing tenant is a Texas agency)', defaulted.state, 'TX');

  await db.updateOrganizationOnboarding(created.organizationId, { state: 'NY' });
  const afterPatch = await db.getOrganization(created.organizationId);
  eq('updateOrganizationOnboarding can change state after the fact', afterPatch.state, 'NY');

  console.log('\n== lib/state-compliance.js: getComplianceProfile / getAggregatorReasonMap ==');

  const tx = getComplianceProfile('TX');
  check('TX has a configured compliance profile', tx !== null);
  eq('  ...visitMaintenanceWindowDays', tx?.visitMaintenanceWindowDays, 95);
  eq('  ...usageThreshold', tx?.usageThreshold, 80);
  eq('  ...defaultAggregator', tx?.defaultAggregator, 'hhaexchange');
  check('  ...has reasonCodes for every code evv-mapping.js can produce',
    Object.keys(tx?.reasonCodes || {}).length >= 10);

  eq('an unconfigured state (no profile built yet) returns null, not a silent TX fallback',
    getComplianceProfile('ZZ'), null);
  eq('  ...same for a real state Hearth just has not built out (e.g. CA today)',
    getComplianceProfile('CA'), null);

  const txHhax = getAggregatorReasonMap('TX', 'hhaexchange');
  check('TX has an hhaexchange reason-code translation table', txHhax !== null);
  eq('  ...missedVisitDefault present', typeof txHhax?.missedVisitDefault?.reasonCode, 'string');
  eq('getAggregatorReasonMap returns null for an aggregator TX has no mapping for',
    getAggregatorReasonMap('TX', 'sandata'), null);
  eq('getAggregatorReasonMap returns null for an unconfigured state entirely',
    getAggregatorReasonMap('ZZ', 'hhaexchange'), null);

  console.log('\n== lib/evv-mapping.js: buildVisitPayload resolves reason codes BY STATE, not hardcoded ==');

  const credentials = { providerTaxId: '9999999999', officeQualifier: 'NPI', officeIdentifier: '111', payerId: 'P1' };
  const client = { id: 'c1', hhscIndividualNumber: 'MC1', address: '1 Main St' };
  const caregiver = { id: 'cg1' };
  const authorization = { serviceCode: 'S5125' };

  const txException = {
    id: 'v1', serviceDate: '2026-09-14', start: '9:00 AM', end: '11:00 AM',
    caregiverId: 'cg1', status: 'completed',
    evv: { clockIn: '9:00 AM', clockOut: '11:00 AM', exception: '210', note: 'no signal' },
  };
  const txPayload = buildVisitPayload({ credentials, visit: txException, client, caregiver, authorization, state: 'TX' });
  eq('TX exception 210 maps to hhaexchange reasonCode 210 (from the state profile, not a hardcoded constant)',
    txPayload.reasonCode, '210');
  eq('  ...and actionCode 19', txPayload.actionCode, '19');

  const unknownStatePayload = buildVisitPayload({ credentials, visit: txException, client, caregiver, authorization, state: 'ZZ' });
  eq('an unconfigured state falls back to the generic default reason code rather than throwing',
    unknownStatePayload.reasonCode, '222');
  eq('  ...and the generic default action code', unknownStatePayload.actionCode, '25');

  const missedVisit = {
    id: 'v2', serviceDate: '2026-09-14', start: '9:00 AM', end: '11:00 AM',
    caregiverId: 'cg1', status: 'missed', evv: null,
  };
  const missedTx = buildVisitPayload({ credentials, visit: missedVisit, client, caregiver, authorization, state: 'TX' });
  eq('a missed TX visit with no exception code uses hhaexchange missedVisitDefault (601/53)',
    `${missedTx.reasonCode}/${missedTx.actionCode}`, '601/53');
  const missedUnknown = buildVisitPayload({ credentials, visit: missedVisit, client, caregiver, authorization, state: 'ZZ' });
  eq('a missed visit for an unconfigured state falls back to the module-level default, not a crash',
    `${missedUnknown.reasonCode}/${missedUnknown.actionCode}`, '601/53');

  console.log('\n== organization_evv_credentials.aggregator ==');
  await query(
    `INSERT INTO organization_evv_credentials
       (organization_id, api_base_url, client_id_enc, client_secret_enc)
     VALUES ($1,'https://x.test','enc1','enc2')`,
    [created.organizationId]
  );
  const creds = await db.getEvvCredentials(created.organizationId);
  eq('aggregator defaults to hhaexchange when not specified at insert time', creds.aggregator, 'hhaexchange');

  await db.upsertEvvCredentials(defaultedOrg.organizationId, {
    apiBaseUrl: 'https://y.test', clientIdEnc: 'enc3', clientSecretEnc: 'enc4', aggregator: 'sandata',
  });
  const creds2 = await db.getEvvCredentials(defaultedOrg.organizationId);
  eq('upsertEvvCredentials persists an explicit aggregator value', creds2.aggregator, 'sandata');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`MULTI-STATE RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
