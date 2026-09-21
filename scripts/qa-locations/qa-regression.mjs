// Regression QA: the pre-existing EVV / billing behavior that runs THROUGH
// the functions the locations feature modified (clockIn/clockOut now take an
// optional locationId and call the JOIN-based getVisit internally).
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

const ORG = 'org-r';

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Regression Agency','active')`, [ORG]);
  const locId = await db.createLocation(ORG, { name: 'Branch One', commissionRate: 10 });

  const cg = await db.createCaregiverWithLogin(ORG, {
    name: 'Reg CG', role: 'Aide', phone: '1', email: 'reg@x.test', passwordHash: 'x', locationId: locId,
  });
  await query(
    `INSERT INTO referrals (id,organization_id,payer,client_name,dob,service,auth_hours,auth_number,diagnosis,received_date,status)
     VALUES ('rr1',$1,'Medicaid','Reg Client','01/01/1950','PAS','20','A','DX','09/01/2026','new')`, [ORG]
  );
  await db.submitIntake(ORG, 'rr1', { clientName: 'Reg Client', authHours: '20 hrs/wk', locationId: locId, careNeeds: [] });
  const clientId = 'c-rr1';

  // An approved authorization with a 15-minute unit and a real rate.
  // Through the real writer — see the note in qa.mjs about never asserting
  // on a field the production writer was never asked to write.
  const authId = await db.createServiceAuthorization(ORG, {
    clientId, payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS',
    unitMinutes: 15, frequency: 'Weekly', startDate: '09/01/2026',
    endDate: '12/31/2026', status: 'approved', ratePerUnit: 30.00,
  });
  eq('authorization rate round-trips through the real writer',
    (await db.getActiveAuthorization(ORG, clientId))?.ratePerUnit, 30);

  console.log('\n== units/week auto-derives from hours/week (real authorization notices state hours, not units) ==');
  const hoursOnlyAuthId = await db.createServiceAuthorization(ORG, {
    clientId, payer: 'Medicaid', serviceCode: 'S5125', serviceDescription: 'PAS',
    totalHoursPerWeek: 10, unitMinutes: 15, frequency: 'Weekly', startDate: '09/01/2026',
    endDate: '12/31/2026', status: 'approved', ratePerUnit: 25,
  });
  const hoursOnlyRows = await query(`SELECT total_units_per_week FROM service_authorizations WHERE id = $1`, [hoursOnlyAuthId]);
  eq('10 hrs/wk at 15-min units derives to 40 units/wk', Number(hoursOnlyRows[0].total_units_per_week), 40);

  const explicitUnitsAuthId = await db.createServiceAuthorization(ORG, {
    clientId, payer: 'Medicaid', serviceCode: 'S5126', serviceDescription: 'Habilitation',
    totalHoursPerWeek: 10, totalUnitsPerWeek: 99, unitMinutes: 15, frequency: 'Weekly',
    startDate: '09/01/2026', endDate: '12/31/2026', status: 'approved', ratePerUnit: 25,
  });
  const explicitUnitsRows = await query(`SELECT total_units_per_week FROM service_authorizations WHERE id = $1`, [explicitUnitsAuthId]);
  eq('an explicit units/week value is never overridden by the derivation', Number(explicitUnitsRows[0].total_units_per_week), 99);

  const neitherAuthId = await db.createServiceAuthorization(ORG, {
    clientId, payer: 'Medicaid', serviceCode: 'S5127', serviceDescription: 'Respite',
    unitMinutes: 15, frequency: 'Weekly', startDate: '09/01/2026',
    endDate: '12/31/2026', status: 'approved', ratePerUnit: 25,
  });
  const neitherRows = await query(`SELECT total_units_per_week FROM service_authorizations WHERE id = $1`, [neitherAuthId]);
  eq('with neither figure supplied, units/week stays null rather than becoming 0', neitherRows[0].total_units_per_week, null);

  console.log('\n== createVisit: the admin \'schedule a visit\' writer (added for the manual-scheduling gap) ==');
  await throws('rejects a day not on the current schedule week', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, day: 'someday', startTime: '9:00 AM', endTime: '11:00 AM' }));
  await throws('rejects a malformed start time', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, day: 'wed', startTime: '9am', endTime: '11:00 AM' }),
    'must look like');
  await throws('rejects a malformed end time', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, day: 'wed', startTime: '9:00 AM', endTime: 'noon' }),
    'must look like');
  await throws('rejects a caregiver id that does not exist', () =>
    db.createVisit(ORG, { caregiverId: 'nope', clientId, day: 'wed', startTime: '9:00 AM', endTime: '11:00 AM' }),
    'Caregiver not found');
  await throws('rejects a client id that does not exist', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId: 'nope', day: 'wed', startTime: '9:00 AM', endTime: '11:00 AM' }),
    'Client not found');
  await throws('a location-scoped call cannot schedule a caregiver outside that location', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, day: 'wed', startTime: '9:00 AM', endTime: '11:00 AM' }, 'some-other-location'),
    'Caregiver not found');

  const scheduledVisitId = await db.createVisit(
    ORG, { caregiverId: cg, clientId, day: 'wed', startTime: '9:00 AM', endTime: '11:00 AM' }, locId
  );
  check('createVisit returns an id', typeof scheduledVisitId === 'string' && scheduledVisitId.length > 0);
  const scheduled = await db.getVisit(ORG, scheduledVisitId);
  eq('day stored', scheduled.day, 'wed');
  eq('service date resolved from the schedule week (not passed in by the caller)', scheduled.serviceDate, '2026-09-16');
  eq('times stored upper-cased, matching the EVV label format', scheduled.start, '9:00 AM');
  eq('  ...end time too', scheduled.end, '11:00 AM');
  eq('status defaults to scheduled', scheduled.status, 'scheduled');
  eq('no EVV clock-in yet on a freshly scheduled visit', scheduled.evv, null);

  console.log('\n== getOnboardingState: a caregiver must not be stuck forever with no courses set up ==');
  const freshCg = await db.createCaregiverWithLogin(ORG, {
    name: 'Fresh Applicant', role: 'Aide', phone: '2', email: 'fresh@x.test', passwordHash: 'x', locationId: locId,
  });
  const noCoursesState = await db.getOnboardingState(ORG, freshCg);
  eq('with zero courses in the library, training is vacuously complete (not a permanent block)',
    noCoursesState.trainingComplete, true);

  const initialCourseId = await db.createCourse(ORG, { title: 'Orientation', courseType: 'initial' });
  const notDoneState = await db.getOnboardingState(ORG, freshCg);
  eq('once a real initial course exists, an uncompleted one blocks training again',
    notDoneState.trainingComplete, false);
  eq('  ...progress reports 0 of 1', `${notDoneState.trainingProgress.done}/${notDoneState.trainingProgress.total}`, '0/1');

  await db.markCourseComplete(ORG, freshCg, initialCourseId);
  const doneState = await db.getOnboardingState(ORG, freshCg);
  eq('completing the only initial course marks training complete', doneState.trainingComplete, true);

  // A 2-hour visit -> 120 min / 15 = 8 units.
  await query(
    `INSERT INTO visits (id,organization_id,caregiver_id,client_id,day,service_date,start_time,end_time,status)
     VALUES ('rv1',$1,$2,$3,'mon','2026-09-15','9:00 AM','11:00 AM','scheduled')`,
    [ORG, cg, clientId]
  );

  console.log('\n== clockIn / clockOut still work (locationId passed, as the action now does) ==');

  await db.clockIn(ORG, 'rv1', locId);
  const inProgress = await db.getVisit(ORG, 'rv1');
  eq('clockIn set status in-progress', inProgress.status, 'in-progress');
  eq('clockIn recorded an EVV clock-in', inProgress.evv?.clockIn, 'Just now');
  eq('clockIn set the GPS method', inProgress.evv?.method, 'GPS mobile check-in');

  await db.clockOut(ORG, 'rv1', locId);
  const done = await db.getVisit(ORG, 'rv1');
  eq('clockOut set status completed', done.status, 'completed');
  eq('clockOut marked the visit resolved', done.resolved, true);
  eq('clockOut marked EVV verified', done.evv?.verified, true);

  console.log('\n== billing generation still fires from clockOut (EVV not live) ==');
  const lineId = await db.getBillingLineByVisit(ORG, 'rv1');
  check('clockOut auto-generated a billing line', lineId !== null);
  const lines = await db.getBillingLines(ORG);
  eq('getBillingLines returns it', lines.length, 1);
  eq('  units = 120min / 15min unit', lines[0].units, 8);
  eq('  service code came from the authorization', lines[0].serviceCode, 'S5125');
  eq('  status is pending (needs office review)', lines[0].status, 'pending');
  eq('  client name joined in', lines[0].clientName, 'Reg Client');

  console.log('\n== the generated line flows into the franchise rollup ==');
  const summary = await db.getLocationRevenueSummary(ORG);
  eq('one location in the rollup', summary.length, 1);
  eq('revenue = 8 units x $30', summary[0].revenue, 240);
  eq('commission @10%', summary[0].commissionAmount, 24);
  eq('counted as a rated line', summary[0].ratedLineCount, 1);
  eq('no unrated lines', summary[0].unratedLineCount, 0);

  console.log('\n== an EVV exception / VMUR path still works ==');
  await query(`UPDATE visits SET evv_exception = '02', resolved = false WHERE id = 'rv1'`);
  const withExc = await db.getVisit(ORG, 'rv1');
  eq('exception is exposed on the visit', withExc.evv?.exception, '02');
  await db.resolveVisitException(ORG, 'rv1', locId);
  eq('resolveVisitException set resolved', (await db.getVisit(ORG, 'rv1')).resolved, true);
  await db.submitVMUR(ORG, 'rv1', locId);
  eq('submitVMUR recorded', (await db.getVisit(ORG, 'rv1')).vmurSubmitted, true);
  const syncRows = await query(`SELECT operation FROM evv_sync_log WHERE visit_id = 'rv1' ORDER BY operation`);
  check('clock-out + exception-resolve both enqueued EVV sync rows', syncRows.length >= 2,
    JSON.stringify(syncRows.map((r) => r.operation)));

  console.log('\n== unrated authorization: revenue must NOT silently count as $0 ==');
  await query(`UPDATE service_authorizations SET rate_per_unit = NULL WHERE id = $1`, [authId]);
  const noRate = await db.getLocationRevenueSummary(ORG);
  eq('revenue drops to 0 when the rate is removed', noRate[0].revenue, 0);
  eq('the line is now reported as unrated', noRate[0].unratedLineCount, 1);
  eq('and no longer counted as rated', noRate[0].ratedLineCount, 0);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`REGRESSION RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
