// QA for LOCATION_ADMIN read/write scoping — the bug class found on the
// 2026-09-17 bug hunt: readers that ignored locationId, writers that
// accepted any tenant's location id, and inactive locations still being
// valid destinations for new work. Every assertion here goes through the
// real query layer on a real Postgres.
import * as db from './queries.js';
import { query, pool } from './db.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-s';
const OTHER = 'org-x';

async function referral(id, name) {
  await query(
    `INSERT INTO referrals (id,organization_id,payer,client_name,dob,service,auth_hours,auth_number,diagnosis,received_date,status)
     VALUES ($1,$2,'Medicaid',$3,'01/01/1950','PAS','10','A','DX','09/01/2026','new')`, [id, ORG, name]
  );
}

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Scoped Agency','active'),($2,'Other Agency','active')`, [ORG, OTHER]);
  const north = await db.createLocation(ORG, { name: 'North', commissionRate: 10 });
  const south = await db.createLocation(ORG, { name: 'South', commissionRate: 20 });
  const foreign = await db.createLocation(OTHER, { name: 'Foreign', commissionRate: 5 });

  console.log('\n== writers reject a location that is not this organization\'s ==');
  await throws('createCaregiverWithLogin refuses another tenant\'s location',
    () => db.createCaregiverWithLogin(ORG, { name: 'X', role: 'Aide', phone: '1', email: 'x@s.test', passwordHash: 'h', locationId: foreign }),
    'Location not found');
  eq('  ...and created nothing', (await db.getCaregivers(ORG)).length, 0);
  await referral('sr-x', 'Injected');
  await throws('submitIntake refuses another tenant\'s location',
    () => db.submitIntake(ORG, 'sr-x', { clientName: 'Injected', authHours: '10', locationId: foreign, careNeeds: [] }),
    'Location not found');
  eq('  ...and created no client', (await db.getClients(ORG)).length, 0);
  const refAfter = await query(`SELECT status FROM referrals WHERE id = 'sr-x'`);
  eq('  ...and the referral was rolled back to new, not left completed', refAfter[0].status, 'new');

  console.log('\n== an inactive location is not a valid destination for new work ==');
  await db.updateLocation(ORG, south, { status: 'inactive' });
  await throws('hiring into an inactive location is refused',
    () => db.createCaregiverWithLogin(ORG, { name: 'Y', role: 'Aide', phone: '2', email: 'y@s.test', passwordHash: 'h', locationId: south }),
    'inactive');
  await referral('sr-y', 'Late');
  await throws('intake into an inactive location is refused',
    () => db.submitIntake(ORG, 'sr-y', { clientName: 'Late', authHours: '10', locationId: south, careNeeds: [] }),
    'inactive');
  eq('getLocations() still lists the inactive one for admin/config use', (await db.getLocations(ORG)).length, 2);
  const active = await db.getLocations(ORG, { activeOnly: true });
  eq('getLocations({activeOnly}) hides it from the selects', active.length, 1);
  eq('  ...leaving the active one', active[0].id, north);
  await db.updateLocation(ORG, south, { status: 'active' });

  console.log('\n== fixtures: one of everything in each location ==');
  const cgN = await db.createCaregiverWithLogin(ORG, { name: 'North CG', role: 'Aide', phone: '3', email: 'n@s.test', passwordHash: 'h', locationId: north });
  const cgS = await db.createCaregiverWithLogin(ORG, { name: 'South CG', role: 'Aide', phone: '4', email: 's@s.test', passwordHash: 'h', locationId: south });
  await referral('sr-n', 'North Client'); await referral('sr-s', 'South Client');
  await db.submitIntake(ORG, 'sr-n', { clientName: 'North Client', authHours: '10', locationId: north, careNeeds: [] });
  await db.submitIntake(ORG, 'sr-s', { clientName: 'South Client', authHours: '10', locationId: south, careNeeds: [] });
  const clN = 'c-sr-n', clS = 'c-sr-s';
  for (const [cl, tag] of [[clN, 'n'], [clS, 's']]) {
    await db.createServiceAuthorization(ORG, {
      clientId: cl, payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS', unitMinutes: 15,
      frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 20,
    });
    await db.createBillingLine(ORG, { clientId: cl, serviceCode: 'S5125', units: 4, serviceDate: '2026-09-15' });
    await query(
      `INSERT INTO visits (id,organization_id,caregiver_id,client_id,day,service_date,start_time,end_time,status)
       VALUES ($1,$2,$3,$4,'mon','2026-09-15','9:00 AM','10:00 AM','completed')`,
      ['sv-' + tag, ORG, tag === 'n' ? cgN : cgS, cl]
    );
    await db.enqueueEvvSync(ORG, 'sv-' + tag, 'visit_create');
  }
  await db.recordCaregiverCheck(ORG, cgN, { checkType: 'dps_criminal', completedOn: '2026-09-01', result: 'clear' });
  await db.recordCaregiverCheck(ORG, cgS, { checkType: 'dps_criminal', completedOn: '2026-09-01', result: 'clear' });
  const course = await db.createCourse(ORG, { title: 'Orientation', hours: 1, courseType: 'initial' });
  await db.markCourseComplete(ORG, cgN, course);
  await db.markCourseComplete(ORG, cgS, course);

  console.log('\n== every reader a location admin\'s pages call now narrows to one location ==');
  const onlyNorth = (rows, pick) => rows.length === 1 && pick(rows[0]) === clN;
  eq('getBillingLines(org) unscoped sees both', (await db.getBillingLines(ORG)).length, 2);
  check('getBillingLines(org, north) sees only North\'s line', onlyNorth(await db.getBillingLines(ORG, north), (r) => r.clientId));
  check('getAllServiceAuthorizations(org, north) sees only North\'s auth',
    onlyNorth(await db.getAllServiceAuthorizations(ORG, north), (r) => r.clientId));
  const checksN = await db.getAllLatestChecks(ORG, north);
  check('getAllLatestChecks(org, north) sees only North\'s caregiver', checksN.length === 1 && checksN[0].caregiverId === cgN,
    JSON.stringify(checksN.map((c) => c.caregiverId)));
  const compN = await db.getAllCompletions(ORG, north);
  check('getAllCompletions(org, north) sees only North\'s caregiver', compN.length === 1 && compN[0].caregiverId === cgN);
  eq('getAllCompletions(org) unscoped still sees both', (await db.getAllCompletions(ORG)).length, 2);
  const awaitingN = await db.getVisitsAwaitingEvvConfirmation(ORG, north);
  check('getVisitsAwaitingEvvConfirmation(org, north) sees only North\'s visit',
    awaitingN.length === 1 && awaitingN[0].clientId === clN, JSON.stringify(awaitingN.map((v) => v.clientId)));
  const logN = await db.getSyncLog(ORG, 100, north);
  check('getSyncLog(org, limit, north) sees only North\'s sync row', logN.length === 1 && logN[0].visitId === 'sv-n',
    JSON.stringify(logN.map((r) => r.visitId)));
  eq('getSyncLog(org) unscoped still sees both', (await db.getSyncLog(ORG)).length, 2);

  console.log('\n== detail lookups by id refuse a record from another location ==');
  eq('getCaregiver(South CG, scoped to North) is null', await db.getCaregiver(ORG, cgS, north), null);
  eq('getClient(South Client, scoped to North) is null', await db.getClient(ORG, clS, north), null);
  check('getCaregiver(North CG, scoped to North) resolves', (await db.getCaregiver(ORG, cgN, north))?.id === cgN);

  console.log('\n== the rollup is unaffected — it is org-admin only and always org-wide ==');
  const rollup = await db.getLocationRevenueSummary(ORG);
  eq('both locations in the rollup', rollup.length, 2);
  // These lines were created WITHOUT a serviceAuthorizationId — the same
  // shape as the Finance page's manual "add a line" form. Before the fix
  // they were permanently unrated and both figures below read 0.
  eq('a manually-entered line is linked to the client\'s active authorization',
    (await db.getBillingLines(ORG, north))[0].serviceAuthorizationId !== null, true);
  eq('North revenue 4 units x $20', rollup.find((r) => r.id === north).revenue, 80);
  eq('South revenue 4 units x $20', rollup.find((r) => r.id === south).revenue, 80);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`SCOPING RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
