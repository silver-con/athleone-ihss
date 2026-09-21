// QA for the 2026-09-21 platform-dashboard enhancement: the new
// aggregate fields on getAllOrganizationsForPlatform (location/caregiver/
// EVV-exception/billing rollups) and the new org-wide
// getBillingSummaryForPlatform helper that backs
// app/platform/organizations/[id]/page.js's financial snapshot.
//
// Runs the REAL lib/queries.js functions against the throwaway QA
// database, same as the other suites here — see run-qa.sh.
import * as db from './queries.js';
import { query, pool, queryOne } from './db.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ORG = 'org-plat-1';
const OTHER = 'org-plat-2';
const EMPTY = 'org-plat-empty';

async function insertClient(id, organizationId, { locationId = null } = {}) {
  await query(
    `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date, care_needs, location_id)
     VALUES ($1,$2,$3,'Medicaid','10','10','09/01/2026','[]',$4)`,
    [id, organizationId, 'Client ' + id, locationId]
  );
}

async function insertVisit(id, organizationId, { caregiverId, clientId, exception = null, resolved = true }) {
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status, resolved, evv_exception)
     VALUES ($1,$2,$3,$4,'mon','2026-09-15','9:00 AM','10:00 AM','completed',$5,$6)`,
    [id, organizationId, caregiverId, clientId, resolved, exception]
  );
}

async function run() {
  console.log('\n== fixtures: two agencies with a full spread of data, one agency with none ==');
  await query(
    `INSERT INTO organizations (id, name, status) VALUES ($1,'Platform QA Agency','active'),($2,'Other QA Agency','active'),($3,'Empty QA Agency','trial')`,
    [ORG, OTHER, EMPTY]
  );

  const locA = await db.createLocation(ORG, { name: 'Location A', commissionRate: 10 });
  const locB = await db.createLocation(ORG, { name: 'Location B', commissionRate: 20 });

  const cgActive = await db.createCaregiverWithLogin(ORG, { name: 'Active CG', role: 'Aide', phone: '1', email: 'active@p.test', passwordHash: 'h', locationId: locA });
  const cgOnboarding = await db.createCaregiverWithLogin(ORG, { name: 'Onboarding CG', role: 'Aide', phone: '2', email: 'onboarding@p.test', passwordHash: 'h', locationId: locA });
  const cgOnLeave = await db.createCaregiverWithLogin(ORG, { name: 'On Leave CG', role: 'Aide', phone: '3', email: 'onleave@p.test', passwordHash: 'h', locationId: locB });
  const cgApplicant = await db.createCaregiverWithLogin(ORG, { name: 'Applicant CG', role: 'Aide', phone: '4', email: 'applicant@p.test', passwordHash: 'h', locationId: locB });
  await query(`UPDATE caregivers SET status = 'active' WHERE id = $1`, [cgActive]);
  await query(`UPDATE caregivers SET status = 'onboarding' WHERE id = $1`, [cgOnboarding]);
  await query(`UPDATE caregivers SET status = 'on-leave' WHERE id = $1`, [cgOnLeave]);
  // cgApplicant is left at its created-with default, 'applicant'.

  await insertClient('cl-a', ORG, { locationId: locA });
  await insertClient('cl-b', ORG, { locationId: locB });
  await insertClient('cl-c', ORG, {}); // agency-direct — no location

  const authA = await db.createServiceAuthorization(ORG, {
    clientId: 'cl-a', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 20,
  });
  const authB = await db.createServiceAuthorization(ORG, {
    clientId: 'cl-b', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 15,
  });
  // cl-c's authorization deliberately has NO rate — the "unrated" case.
  await db.createServiceAuthorization(ORG, {
    clientId: 'cl-c', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved',
  });

  const lineA1 = await db.createBillingLine(ORG, { clientId: 'cl-a', serviceCode: 'S5125', units: 5, serviceDate: '2026-09-15' });
  const lineA2 = await db.createBillingLine(ORG, { clientId: 'cl-a', serviceCode: 'S5125', units: 2, serviceDate: '2026-09-16' });
  await db.createBillingLine(ORG, { clientId: 'cl-b', serviceCode: 'S5125', units: 3, serviceDate: '2026-09-15' });
  await db.createBillingLine(ORG, { clientId: 'cl-c', serviceCode: 'S5125', units: 4, serviceDate: '2026-09-15' }); // unrated
  await db.updateBillingLineStatus(ORG, lineA2, 'paid');
  // lineA1 (pending, $20/unit x 5 = 100), cl-b's line (pending, $15 x 3 = 45),
  // cl-c's line (pending but unrated, excluded from the dollar total),
  // lineA2 (paid, $20 x 2 = 40).

  await db.upsertEvvCredentials(ORG, {
    apiBaseUrl: 'https://x.test', clientIdEnc: 'enc1', clientSecretEnc: 'enc2',
    aggregator: 'sandata', environment: 'production', status: 'live',
  });
  await insertVisit('v-open-1', ORG, { caregiverId: cgActive, clientId: 'cl-a', exception: '210', resolved: false });
  await insertVisit('v-open-2', ORG, { caregiverId: cgOnLeave, clientId: 'cl-b', exception: '201', resolved: false });
  await insertVisit('v-closed', ORG, { caregiverId: cgActive, clientId: 'cl-a', exception: '210', resolved: true });
  await db.enqueueEvvSync(ORG, 'v-open-1', 'visit_update');
  await query(`UPDATE evv_sync_log SET status = 'failed' WHERE organization_id = $1 AND visit_id = $2`, [ORG, 'v-open-1']);

  // A second agency, entirely separate, to prove none of the above leaks
  // across the organization_id boundary in the fleet-wide query.
  const otherLoc = await db.createLocation(OTHER, { name: 'Other Loc', commissionRate: 5 });
  await db.createCaregiverWithLogin(OTHER, { name: 'Other CG', role: 'Aide', phone: '9', email: 'other@p.test', passwordHash: 'h', locationId: otherLoc });
  await insertClient('cl-other', OTHER, { locationId: otherLoc });
  await db.createServiceAuthorization(OTHER, {
    clientId: 'cl-other', payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
    frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 100,
  });
  await db.createBillingLine(OTHER, { clientId: 'cl-other', serviceCode: 'S5125', units: 1, serviceDate: '2026-09-15' });

  console.log('\n== getAllOrganizationsForPlatform: per-org aggregates ==');
  const all = await db.getAllOrganizationsForPlatform();
  const orgRow = all.find((o) => o.id === ORG);
  const otherRow = all.find((o) => o.id === OTHER);
  const emptyRow = all.find((o) => o.id === EMPTY);
  check('all three seeded agencies are present', Boolean(orgRow && otherRow && emptyRow));

  eq('locationCount', orgRow.locationCount, 2);
  eq('caregiverTotalCount', orgRow.caregiverTotalCount, 4);
  eq('caregiverActiveCount', orgRow.caregiverActiveCount, 1);
  eq('caregiverPipelineCount counts applicant + onboarding', orgRow.caregiverPipelineCount, 2);
  eq('caregiverOnLeaveCount', orgRow.caregiverOnLeaveCount, 1);
  eq('evvAggregator', orgRow.evvAggregator, 'sandata');
  eq('evvStatus', orgRow.evvStatus, 'live');
  eq('evvFailedCount counts the one failed sync row', orgRow.evvFailedCount, 1);
  eq('openExceptionCount counts only unresolved exceptions (v-closed excluded)', orgRow.openExceptionCount, 2);
  eq('billingPendingAmount excludes the unrated line and the paid line', orgRow.billingPendingAmount, 145);
  eq('billingUnratedCount', orgRow.billingUnratedCount, 1);

  eq('a second agency\'s aggregates do not leak into the first\'s row', otherRow.billingPendingAmount, 100);
  eq('  ...and vice versa is unaffected', otherRow.locationCount, 1);

  console.log('\n== getAllOrganizationsForPlatform: an agency with no locations/caregivers/billing/EVV at all ==');
  eq('locationCount defaults to 0, not null/NaN', emptyRow.locationCount, 0);
  eq('caregiverTotalCount defaults to 0', emptyRow.caregiverTotalCount, 0);
  eq('billingPendingAmount defaults to 0', emptyRow.billingPendingAmount, 0);
  eq('billingUnratedCount defaults to 0', emptyRow.billingUnratedCount, 0);
  eq('openExceptionCount defaults to 0', emptyRow.openExceptionCount, 0);
  eq('evvStatus is null (never configured), not a bogus default', emptyRow.evvStatus, null);
  eq('evvAggregator is null', emptyRow.evvAggregator, null);

  console.log('\n== getBillingSummaryForPlatform: org-wide, including agency-direct (no-location) clients ==');
  const billing = await db.getBillingSummaryForPlatform(ORG);
  eq('totalLineCount', billing.totalLineCount, 4);
  eq('pendingLineCount', billing.pendingLineCount, 3);
  eq('unratedLineCount', billing.unratedLineCount, 1);
  eq('pendingAmount matches the fleet-wide rollup\'s billingPendingAmount for the same org', billing.pendingAmount, orgRow.billingPendingAmount);
  eq('pendingAmount', billing.pendingAmount, 145);
  eq('paidAmount', billing.paidAmount, 40);

  const emptyBilling = await db.getBillingSummaryForPlatform(EMPTY);
  eq('an agency with no billing lines gets all-zero totals, not a crash', emptyBilling.totalLineCount, 0);
  eq('  ...pendingAmount 0', emptyBilling.pendingAmount, 0);

  const otherBilling = await db.getBillingSummaryForPlatform(OTHER);
  eq('a second agency\'s billing summary is scoped to its own lines only', otherBilling.pendingAmount, 100);

  console.log('\n== lib/permissions.js: the new per-tenant platform route is covered ==');
  const { PERMISSIONS, ROUTE_PERMISSIONS } = await import('./permissions.js');
  const match = ROUTE_PERMISSIONS.find((r) => r.test(`/platform/organizations/${ORG}`));
  check('a URL like /platform/organizations/<id> resolves to a catalog entry', Boolean(match));
  eq('  ...specifically platform.organizations.view', match?.key, 'platform.organizations.view');
  check('  ...and that key exists in the permission catalog', Boolean(PERMISSIONS[match?.key]));
  eq('  ...restricted to PLATFORM_ADMIN, matching every other /platform page', PERMISSIONS[match?.key]?.roles?.join(','), 'PLATFORM_ADMIN');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`PLATFORM DASHBOARD RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
