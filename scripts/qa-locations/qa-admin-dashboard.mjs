// QA for the 2026-09-21 agency-side admin dashboard enhancement
// (app/admin/page.js): the new getBillingSummary(organizationId,
// locationId) query, its equivalence with getBillingSummaryForPlatform
// when unscoped, and correct behavior for a location with no billing
// activity at all.
//
// Runs the REAL lib/queries.js functions against the throwaway QA
// database, same as the other suites here — see run-qa.sh.
import * as db from './queries.js';
import { query, pool } from './db.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ORG = 'org-admin-dash';

async function insertClient(id, organizationId, { locationId = null } = {}) {
  await query(
    `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date, care_needs, location_id)
     VALUES ($1,$2,$3,'Medicaid','10','10','09/01/2026','[]',$4)`,
    [id, organizationId, 'Client ' + id, locationId]
  );
}

async function run() {
  console.log('\n== fixtures: two locations with billing activity, one with none, and an agency-direct client ==');
  await query(`INSERT INTO organizations (id, name, status) VALUES ($1,'Admin Dashboard QA Agency','active')`, [ORG]);

  const locA = await db.createLocation(ORG, { name: 'Loc A', commissionRate: 10 });
  const locB = await db.createLocation(ORG, { name: 'Loc B', commissionRate: 15 });
  const locC = await db.createLocation(ORG, { name: 'Loc C (quiet)', commissionRate: 5 });

  await insertClient('cl-a', ORG, { locationId: locA });
  await insertClient('cl-b', ORG, { locationId: locB });
  await insertClient('cl-direct', ORG, {}); // agency-direct — no location

  await db.createServiceAuthorization(ORG, {
    clientId: 'cl-a', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 10,
  });
  await db.createServiceAuthorization(ORG, {
    clientId: 'cl-b', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 20,
  });
  // cl-direct's authorization deliberately carries no rate — the unrated case.
  await db.createServiceAuthorization(ORG, {
    clientId: 'cl-direct', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved',
  });

  const lineA1 = await db.createBillingLine(ORG, { clientId: 'cl-a', serviceCode: 'S5125', units: 5, serviceDate: '2026-09-15' });
  const lineA2 = await db.createBillingLine(ORG, { clientId: 'cl-a', serviceCode: 'S5125', units: 2, serviceDate: '2026-09-16' });
  await db.createBillingLine(ORG, { clientId: 'cl-b', serviceCode: 'S5125', units: 3, serviceDate: '2026-09-15' });
  await db.createBillingLine(ORG, { clientId: 'cl-direct', serviceCode: 'S5125', units: 4, serviceDate: '2026-09-15' }); // unrated
  await db.updateBillingLineStatus(ORG, lineA2, 'paid');
  void lineA1;

  console.log('\n== getBillingSummary(org, locationId): each location sees only its own lines ==');
  const summaryA = await db.getBillingSummary(ORG, locA);
  eq('Loc A totalLineCount', summaryA.totalLineCount, 2);
  eq('Loc A pendingLineCount', summaryA.pendingLineCount, 1);
  eq('Loc A pendingAmount (5 units x $10)', summaryA.pendingAmount, 50);
  eq('Loc A paidAmount (2 units x $10)', summaryA.paidAmount, 20);
  eq('Loc A unratedLineCount', summaryA.unratedLineCount, 0);

  const summaryB = await db.getBillingSummary(ORG, locB);
  eq('Loc B totalLineCount', summaryB.totalLineCount, 1);
  eq('Loc B pendingAmount (3 units x $20)', summaryB.pendingAmount, 60);
  eq('Loc B paidAmount', summaryB.paidAmount, 0);

  const summaryC = await db.getBillingSummary(ORG, locC);
  eq('a location with no billing activity gets all-zero totals, not a crash', summaryC.totalLineCount, 0);
  eq('  ...pendingAmount 0', summaryC.pendingAmount, 0);

  console.log('\n== getBillingSummary(org, null): org-wide, including the agency-direct client ==');
  const summaryOrg = await db.getBillingSummary(ORG, null);
  eq('org-wide totalLineCount includes all four lines', summaryOrg.totalLineCount, 4);
  eq('org-wide pendingLineCount', summaryOrg.pendingLineCount, 3);
  eq('org-wide unratedLineCount catches the agency-direct client\'s unrated line', summaryOrg.unratedLineCount, 1);
  eq('org-wide pendingAmount (Loc A + Loc B, agency-direct excluded since unrated)', summaryOrg.pendingAmount, 110);
  eq('org-wide paidAmount', summaryOrg.paidAmount, 20);

  console.log('\n== getBillingSummaryForPlatform stays identical to getBillingSummary(org, null) ==');
  const platformSummary = await db.getBillingSummaryForPlatform(ORG);
  eq('totalLineCount matches', platformSummary.totalLineCount, summaryOrg.totalLineCount);
  eq('pendingAmount matches', platformSummary.pendingAmount, summaryOrg.pendingAmount);
  eq('paidAmount matches', platformSummary.paidAmount, summaryOrg.paidAmount);
  eq('unratedLineCount matches', platformSummary.unratedLineCount, summaryOrg.unratedLineCount);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`ADMIN DASHBOARD RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
