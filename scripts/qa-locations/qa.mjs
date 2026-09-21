// Automated QA for the locations / franchise feature.
// Runs the REAL lib/queries.js functions against a throwaway Postgres
// loaded from the REAL db/schema.sql. No mocks of the query layer.
import * as db from './queries.js';
import { query, pool } from './db.js';

let pass = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------- fixtures
const ORG = 'org-a';
const OTHER_ORG = 'org-b';

async function seed() {
  await query(
    `INSERT INTO organizations (id, name, status) VALUES ($1,'Agency A','active'), ($2,'Agency B','active')`,
    [ORG, OTHER_ORG]
  );
}

const results = {};

async function run() {
  await seed();

  // ------------------------------------------------------------------ 1
  await section('createLocation / getLocations / getLocation');

  const houstonId = await db.createLocation(ORG, { name: 'Houston Metro', commissionRate: 12.5 });
  const dallasId = await db.createLocation(ORG, { name: 'Dallas Partner', commissionRate: 30 });
  // A location with no explicit rate — exercises the ?? 0 default.
  const austinId = await db.createLocation(ORG, { name: 'Austin Branch' });
  // Cross-tenant location, must never leak into ORG's results.
  const foreignId = await db.createLocation(OTHER_ORG, { name: 'Agency B Site', commissionRate: 99 });

  const locs = await db.getLocations(ORG);
  eq('getLocations returns only this org\'s locations', locs.length, 3);
  check('getLocations excludes the other tenant', !locs.some((l) => l.id === foreignId));
  eq('getLocations is ordered by name', locs.map((l) => l.name).join('|'), 'Austin Branch|Dallas Partner|Houston Metro');
  eq('commissionRate is mapped as a Number, not a string', typeof locs[2].commissionRate, 'number');
  eq('commission_rate numeric(5,2) round-trips 12.5', locs[2].commissionRate, 12.5);
  eq('commissionRate defaults to 0 when omitted', locs[0].commissionRate, 0);
  eq('status defaults to active', locs[0].status, 'active');

  eq('getLocation finds one by id', (await db.getLocation(ORG, houstonId))?.name, 'Houston Metro');
  eq('getLocation is tenant-scoped (foreign id returns null)', await db.getLocation(ORG, foreignId), null);

  // CHECK constraint on commission_rate
  let rejected = false;
  try {
    await db.createLocation(ORG, { name: 'Bad Rate', commissionRate: 150 });
  } catch {
    rejected = true;
  }
  check('commission_rate > 100 is rejected by the CHECK constraint', rejected);

  results.houstonId = houstonId;
  results.dallasId = dallasId;
  results.austinId = austinId;
  results.foreignId = foreignId;

  // ------------------------------------------------------------------ 2
  await section('caregivers / clients scoped by location');

  // Caregivers: one per location + one agency-wide (null location).
  const cgHouston = await db.createCaregiverWithLogin(ORG, {
    name: 'Houston CG', role: 'Home Care Aide', phone: '111', email: 'h@x.test',
    passwordHash: 'x', locationId: houstonId,
  });
  const cgDallas = await db.createCaregiverWithLogin(ORG, {
    name: 'Dallas CG', role: 'Home Care Aide', phone: '222', email: 'd@x.test',
    passwordHash: 'x', locationId: dallasId,
  });
  const cgAgency = await db.createCaregiverWithLogin(ORG, {
    name: 'Agency Wide CG', role: 'Registered Nurse', phone: '333', email: 'a@x.test',
    passwordHash: 'x',
  });

  const allCg = await db.getCaregivers(ORG);
  eq('getCaregivers(org) returns every caregiver when locationId is omitted', allCg.length, 3);
  const houstonCg = await db.getCaregivers(ORG, houstonId);
  eq('getCaregivers(org, locationId) filters to that location', houstonCg.length, 1);
  eq('  ...and it is the right one', houstonCg[0].name, 'Houston CG');
  eq('mapCaregiver exposes locationId', houstonCg[0].locationId, houstonId);
  eq('agency-wide caregiver has null locationId', allCg.find((c) => c.name === 'Agency Wide CG').locationId, null);

  eq('getCaregiver by id, no location filter', (await db.getCaregiver(ORG, cgDallas))?.name, 'Dallas CG');
  eq('getCaregiver with matching location', (await db.getCaregiver(ORG, cgDallas, dallasId))?.name, 'Dallas CG');
  eq('getCaregiver with WRONG location returns null', await db.getCaregiver(ORG, cgDallas, houstonId), null);

  // The caregiver's own user row must inherit location_id.
  const userRow = await query('SELECT location_id, role FROM users WHERE caregiver_id = $1', [cgHouston]);
  eq('createCaregiverWithLogin sets the user row role', userRow[0].role, 'CAREGIVER');
  eq('createCaregiverWithLogin propagates location_id to the user row', userRow[0].location_id, houstonId);

  // Clients via submitIntake (the real transactional path).
  async function makeClientViaIntake(refId, name, locationId, hours) {
    await query(
      `INSERT INTO referrals (id, organization_id, payer, client_name, dob, service, auth_hours,
                              auth_number, diagnosis, received_date, status)
       VALUES ($1,$2,'Medicaid',$3,'01/01/1950','PAS',$4,'AUTH-1','DX','09/15/2026','new')`,
      [refId, ORG, name, hours]
    );
    await db.submitIntake(ORG, refId, { clientName: name, authHours: hours, locationId, careNeeds: [] });
    return 'c-' + refId;
  }

  const clHouston = await makeClientViaIntake('r1', 'Houston Client', houstonId, '20 hrs/wk');
  const clDallas = await makeClientViaIntake('r2', 'Dallas Client', dallasId, '10 hrs/wk');
  const clAgency = await makeClientViaIntake('r3', 'Agency Client', null, '5 hrs/wk');

  const allClients = await db.getClients(ORG);
  eq('getClients(org) returns all clients when locationId omitted', allClients.length, 3);
  const houstonClients = await db.getClients(ORG, houstonId);
  eq('getClients(org, locationId) filters', houstonClients.length, 1);
  eq('submitIntake persisted locationId', houstonClients[0].locationId, houstonId);
  eq('mapClient exposes locationId as null for agency-wide', allClients.find((c) => c.id === clAgency).locationId, null);
  eq('getClient with WRONG location returns null', await db.getClient(ORG, clDallas, houstonId), null);
  eq('getClient with matching location works', (await db.getClient(ORG, clDallas, dallasId))?.name, 'Dallas Client');

  results.cgHouston = cgHouston; results.cgDallas = cgDallas; results.cgAgency = cgAgency;
  results.clHouston = clHouston; results.clDallas = clDallas; results.clAgency = clAgency;

  // ------------------------------------------------------------------ 3
  await section('visits derived through the clients/caregivers JOIN');

  async function makeVisit(id, caregiverId, clientId, day, start, end) {
    await query(
      `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status)
       VALUES ($1,$2,$3,$4,$5,'2026-09-15',$6,$7,'scheduled')`,
      [id, ORG, caregiverId, clientId, day, start, end]
    );
  }
  await makeVisit('v1', cgHouston, clHouston, 'mon', '9:00 AM', '11:00 AM');
  await makeVisit('v2', cgDallas, clDallas, 'tue', '1:00 PM', '2:00 PM');
  await makeVisit('v3', cgAgency, clAgency, 'wed', '8:00 AM', '9:00 AM');

  const allVisits = await db.getVisits(ORG);
  eq('getVisits(org) returns every visit when locationId omitted', allVisits.length, 3);
  check('  ...including visits whose client has NO location (inner JOIN does not drop them)',
    allVisits.some((v) => v.id === 'v3'));
  const houstonVisits = await db.getVisits(ORG, houstonId);
  eq('getVisits(org, locationId) filters via clients.location_id', houstonVisits.length, 1);
  eq('  ...and it is the right visit', houstonVisits[0].id, 'v1');
  eq('mapVisit still works off the v.* alias (start_time mapped)', houstonVisits[0].start, '9:00 AM');

  eq('getVisit no filter', (await db.getVisit(ORG, 'v2'))?.id, 'v2');
  eq('getVisit matching location', (await db.getVisit(ORG, 'v2', dallasId))?.id, 'v2');
  eq('getVisit WRONG location returns null', await db.getVisit(ORG, 'v2', houstonId), null);

  const cgVisits = await db.getVisitsForCaregiver(ORG, cgHouston);
  eq('getVisitsForCaregiver no filter', cgVisits.length, 1);
  eq('getVisitsForCaregiver matching location', (await db.getVisitsForCaregiver(ORG, cgHouston, houstonId)).length, 1);
  eq('getVisitsForCaregiver WRONG location', (await db.getVisitsForCaregiver(ORG, cgHouston, dallasId)).length, 0);

  eq('getVisitsForClient no filter', (await db.getVisitsForClient(ORG, clDallas)).length, 1);
  eq('getVisitsForClient WRONG location', (await db.getVisitsForClient(ORG, clDallas, houstonId)).length, 0);

  // ------------------------------------------------------------------ 4
  await section('mutation location guards (defense in depth)');

  async function expectThrow(name, fn) {
    let threw = false;
    try { await fn(); } catch { threw = true; }
    check(name, threw);
  }
  async function expectNoThrow(name, fn) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    check(name, err === null, err?.message);
  }

  await expectThrow('assignCaregiver refuses a client outside the caller\'s location',
    () => db.assignCaregiver(ORG, clDallas, cgDallas, houstonId));
  await expectNoThrow('assignCaregiver allows the caller\'s own location',
    () => db.assignCaregiver(ORG, clDallas, cgDallas, dallasId));
  eq('  ...and the assignment actually persisted',
    (await db.getClient(ORG, clDallas))?.assignedCaregiverId, cgDallas);
  await expectNoThrow('assignCaregiver with null locationId (org admin) still works',
    () => db.assignCaregiver(ORG, clHouston, cgHouston, null));

  await expectThrow('toggleCaregiverStatus refuses a caregiver outside the location',
    () => db.toggleCaregiverStatus(ORG, cgDallas, houstonId));
  await expectNoThrow('toggleCaregiverStatus allows own location',
    () => db.toggleCaregiverStatus(ORG, cgDallas, dallasId));

  await expectThrow('resolveVisitException refuses a visit outside the location',
    () => db.resolveVisitException(ORG, 'v2', houstonId));
  await expectThrow('submitVMUR refuses a visit outside the location',
    () => db.submitVMUR(ORG, 'v2', houstonId));
  await expectThrow('clockIn refuses a visit outside the location',
    () => db.clockIn(ORG, 'v2', houstonId));

  // toggleVisitTask returns silently (does not throw) on a miss — verify it
  // makes no change rather than erroring.
  await query(`UPDATE visits SET tasks = $1 WHERE id = 'v2'`, [JSON.stringify([{ id: 't1', label: 'Bathing', done: false }])]);
  await expectNoThrow('toggleVisitTask with wrong location does not throw',
    () => db.toggleVisitTask(ORG, 'v2', 't1', houstonId));
  const afterWrongLoc = await db.getVisit(ORG, 'v2');
  eq('  ...and it left the task untouched', afterWrongLoc.tasks[0].done, false);
  await db.toggleVisitTask(ORG, 'v2', 't1', dallasId);
  eq('toggleVisitTask with the correct location does toggle', (await db.getVisit(ORG, 'v2')).tasks[0].done, true);

  // ------------------------------------------------------------------ 5
  await section('getLocationRevenueSummary — franchise commission rollup');

  // Houston: an authorization WITH a rate. 4 units x $25.00 = $100.00
  // Deliberately through the REAL writer, not raw SQL. The first version of
  // this suite inserted rate_per_unit directly and therefore passed while
  // createServiceAuthorization silently dropped the column — the rollup
  // could never have shown a non-zero figure in the running app. Never
  // assert on a field the production writer was never asked to write.
  const authH = await db.createServiceAuthorization(ORG, {
    clientId: clHouston, payer: 'Medicaid', serviceCode: 'S5125',
    serviceDescription: 'PAS attendant care', unitMinutes: 15, frequency: 'Weekly',
    startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved',
    ratePerUnit: 25.00,
  });
  const roundTripped = await db.getServiceAuthorizations(ORG, clHouston);
  eq('createServiceAuthorization PERSISTS ratePerUnit', roundTripped[0].ratePerUnit, 25);
  eq('  ...and mapAuthorization exposes it as a Number', typeof roundTripped[0].ratePerUnit, 'number');
  // Dallas: an authorization with NO rate -> its lines must count as "unrated".
  // No rate supplied — must come back as null, not 0.
  const authD = await db.createServiceAuthorization(ORG, {
    clientId: clDallas, payer: 'Medicaid', serviceCode: 'S5125',
    serviceDescription: 'PAS attendant care', unitMinutes: 15, frequency: 'Weekly',
    startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved',
  });
  const noRate = await db.getServiceAuthorizations(ORG, clDallas);
  eq('omitting ratePerUnit stores null, not 0', noRate[0].ratePerUnit, null);

  async function billing(id, clientId, authId, units) {
    await query(
      `INSERT INTO billing_lines (id, organization_id, client_id, service_authorization_id, service_code, units, service_date, status)
       VALUES ($1,$2,$3,$4,'S5125',$5,'2026-09-15','pending')`,
      [id, ORG, clientId, authId, units]
    );
  }
  await billing('b1', clHouston, authH, 4);   // 4 x 25 = 100
  await billing('b2', clHouston, authH, 2);   // 2 x 25 = 50  => Houston 150
  await billing('b3', clDallas, authD, 8);    // unrated
  await billing('b4', clAgency, null, 10);       // agency-wide client, no location

  const summary = await db.getLocationRevenueSummary(ORG);
  eq('summary has one row per location', summary.length, 3);
  const byName = Object.fromEntries(summary.map((s) => [s.name, s]));

  eq('Houston rated revenue = 6 units x $25', byName['Houston Metro'].revenue, 150);
  eq('Houston rated line count', byName['Houston Metro'].ratedLineCount, 2);
  eq('Houston has no unrated lines', byName['Houston Metro'].unratedLineCount, 0);
  eq('Houston commission @12.5% of $150', byName['Houston Metro'].commissionAmount, 18.75);

  eq('Dallas revenue excludes unrated lines (not counted as $0 silently)', byName['Dallas Partner'].revenue, 0);
  eq('Dallas unrated line count is surfaced', byName['Dallas Partner'].unratedLineCount, 1);
  eq('Dallas rated line count is 0', byName['Dallas Partner'].ratedLineCount, 0);
  eq('Dallas commission on $0 revenue is $0', byName['Dallas Partner'].commissionAmount, 0);

  eq('Austin (no clients at all) reports zero revenue', byName['Austin Branch'].revenue, 0);
  eq('Austin reports zero lines, not null', byName['Austin Branch'].unratedLineCount, 0);

  const summaryTotal = summary.reduce((s, l) => s + l.revenue, 0);
  eq('agency-direct client revenue is NOT attributed to any location', summaryTotal, 150);

  check('revenue is a Number not a string', typeof byName['Houston Metro'].revenue === 'number');
  check('commissionRate is a Number not a string', typeof byName['Houston Metro'].commissionRate === 'number');

  // Cross-tenant: Agency B must see only its own (empty) location.
  const bSummary = await db.getLocationRevenueSummary(OTHER_ORG);
  eq('rollup is tenant-scoped', bSummary.length, 1);
  eq('  ...and sees none of Agency A\'s revenue', bSummary[0].revenue, 0);

  // ------------------------------------------------------------------ 6
  await section('tenant isolation still holds with the new params');

  eq('getClients for org B sees none of org A\'s clients', (await db.getClients(OTHER_ORG)).length, 0);
  eq('getCaregivers for org B is empty', (await db.getCaregivers(OTHER_ORG)).length, 0);
  eq('getVisits for org B is empty', (await db.getVisits(OTHER_ORG)).length, 0);
  // Passing org A's location id while scoped to org B must not cross the boundary.
  eq('org B + org A location id returns nothing', (await db.getClients(OTHER_ORG, houstonId)).length, 0);

  let orgIdRequired = false;
  try { await db.getLocations(null); } catch { orgIdRequired = true; }
  check('getLocations still enforces requireOrgId', orgIdRequired);
  let summaryOrgRequired = false;
  try { await db.getLocationRevenueSummary(undefined); } catch { summaryOrgRequired = true; }
  check('getLocationRevenueSummary enforces requireOrgId', summaryOrgRequired);

  // ------------------------------------------------------------------ 7
  await section('ON DELETE SET NULL — deleting a location does not delete people');

  await query('DELETE FROM locations WHERE id = $1', [dallasId]);
  const survivingCg = await db.getCaregiver(ORG, cgDallas);
  check('caregiver survives its location being deleted', survivingCg !== null);
  eq('  ...with locationId set back to null', survivingCg?.locationId, null);
  const survivingClient = await db.getClient(ORG, clDallas);
  check('client survives its location being deleted', survivingClient !== null);
  eq('  ...with locationId set back to null', survivingClient?.locationId, null);
  const userAfter = await query('SELECT location_id FROM users WHERE caregiver_id = $1', [cgDallas]);
  eq('  ...and the user row is nulled too, not deleted', userAfter[0]?.location_id, null);
}

run()
  .then(async () => {
    console.log('\n' + '='.repeat(60));
    console.log(`RESULT: ${pass} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('\nFAILURES:');
      failures.forEach((f) => console.log('  - ' + f));
    }
    await pool.end();
    process.exit(failures.length ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('\nHARNESS ERROR:', err);
    await pool.end();
    process.exit(2);
  });
