// Regression QA: the pre-existing EVV / billing behavior that runs THROUGH
// the functions the locations feature modified (clockIn/clockOut now take an
// optional locationId and call the JOIN-based getVisit internally).
import * as db from './queries.js';
import { todayIso, addDays, getWeek, mondayOf } from './calendar.js';
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
  // Explicit even though false is now the column default — this suite's
  // existing clockOut assertions below (resolved === true, no exception)
  // predate the flexible-hours grace-period check added 2026-09-23 and
  // aren't testing it, so keep it off here regardless of the default; see
  // the dedicated "flexible-hours grace-period check" section near the
  // end of this file for the feature's own tests.
  await query(`UPDATE organizations SET flexible_hours_enabled = false WHERE id = $1`, [ORG]);
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
  await throws('rejects a malformed date', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, serviceDate: '2026-02-30', startTime: '9:00 AM', endTime: '11:00 AM' }),
    'Pick the date');
  await throws('rejects a date past the visit maintenance window', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, serviceDate: addDays(todayIso(), -120), startTime: '9:00 AM', endTime: '11:00 AM' }),
    'maintenance window');
  await throws('rejects a date more than a year ahead', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, serviceDate: addDays(todayIso(), 400), startTime: '9:00 AM', endTime: '11:00 AM' }),
    'up to a year ahead');
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
    ORG, { caregiverId: cg, clientId, day: 'wed', startTime: '9:00 AM', endTime: '11:00 AM', serviceAuthorizationId: authId }, locId
  );
  check('createVisit returns an id', typeof scheduledVisitId === 'string' && scheduledVisitId.length > 0);
  const scheduled = await db.getVisit(ORG, scheduledVisitId);
  eq('day stored', scheduled.day, 'wed');
  eq('a bare weekday resolves to that day of the REAL current week (not the old fixed demo week)',
    scheduled.serviceDate, getWeek(mondayOf(todayIso())).find((d) => d.key === 'wed').iso);
  const datedId = await db.createVisit(
    ORG, { caregiverId: cg, clientId, serviceDate: addDays(todayIso(), 10), startTime: '9:00 AM', endTime: '11:00 AM', serviceAuthorizationId: authId }, locId
  );
  const dated = await db.getVisit(ORG, datedId);
  eq('an explicit date is stored as given', dated.serviceDate, addDays(todayIso(), 10));
  eq('  ...and its weekday key is derived from it', dated.day, getWeek(mondayOf(addDays(todayIso(), 10))).find((d) => d.iso === addDays(todayIso(), 10)).key);
  await query('DELETE FROM visits WHERE id = $1', [datedId]);
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
    `INSERT INTO visits (id,organization_id,caregiver_id,client_id,day,service_date,start_time,end_time,status,service_authorization_id)
     VALUES ('rv1',$1,$2,$3,'mon','2026-09-15','9:00 AM','11:00 AM','scheduled',$4)`,
    [ORG, cg, clientId, authId]
  );

  console.log('\n== clockIn / clockOut still work (locationId passed, as the action now does) ==');

  await db.clockIn(ORG, 'rv1', locId);
  const inProgress = await db.getVisit(ORG, 'rv1');
  eq('clockIn set status in-progress', inProgress.status, 'in-progress');
  // 2026-09-22: clockIn now writes a real formatted time label (e.g.
  // "2:47 PM") and a real evv_clock_in_at timestamp instead of the old
  // literal 'Just now' placeholder — assert the shape rather than a fixed
  // string, since the actual value depends on when this test runs.
  check('clockIn recorded a real 12-hour EVV clock-in time label',
    /^\d{1,2}:\d{2}\s(AM|PM)$/.test(inProgress.evv?.clockIn || ''),
    `got ${JSON.stringify(inProgress.evv?.clockIn)}`);
  check('clockIn recorded a real clockInAt timestamp', inProgress.evv?.clockInAt != null);
  check('clockIn recorded no coordinates (QA harness passes no geo)',
    inProgress.evv?.clockInLat == null && inProgress.evv?.clockInLng == null);
  eq('clockIn set the no-location method (QA harness passes no geo)',
    inProgress.evv?.method, 'Mobile check-in (no location)');

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

  console.log('\n== createVisit: explicit authorization pick resolves the billing-ambiguity bug ==');
  // c-rr1 now legitimately has FOUR concurrently-approved authorizations
  // (authId, hoursOnlyAuthId, explicitUnitsAuthId, neitherAuthId) -- exactly
  // the real-world scenario (PAS attendant care + a separate Respite
  // authorization, say) that made the old getActiveAuthorization guess in
  // generateBillingLineForVisit arbitrary / timing-dependent. See
  // claude/deferred-backlog.md.

  await throws('omitting the pick is rejected when the client has more than one active authorization', () =>
    db.createVisit(ORG, { caregiverId: cg, clientId, day: 'thu', startTime: '9:00 AM', endTime: '11:00 AM' }, locId),
    'more than one active authorization');

  await throws("a serviceAuthorizationId belonging to a different client is rejected", () =>
    db.createVisit(ORG, {
      caregiverId: cg, clientId, day: 'thu', startTime: '9:00 AM', endTime: '11:00 AM',
      serviceAuthorizationId: 'not-this-clients-auth',
    }, locId),
    'does not belong to this client');

  const disambiguatedVisitId = await db.createVisit(
    ORG, {
      caregiverId: cg, clientId, day: 'thu', startTime: '9:00 AM', endTime: '11:00 AM',
      serviceAuthorizationId: explicitUnitsAuthId,
    }, locId
  );
  const disambiguated = await db.getVisit(ORG, disambiguatedVisitId);
  eq('the explicit pick round-trips through getVisit', disambiguated.serviceAuthorizationId, explicitUnitsAuthId);

  await db.clockIn(ORG, disambiguatedVisitId, locId);
  await db.clockOut(ORG, disambiguatedVisitId, locId);
  const disambiguatedLineId = await db.getBillingLineByVisit(ORG, disambiguatedVisitId);
  check('clockOut generated a billing line for the disambiguated visit', disambiguatedLineId !== null);
  const allLinesAfterDisambiguation = await db.getBillingLines(ORG);
  const disambiguatedLine = allLinesAfterDisambiguation.find((l) => l.visitId === disambiguatedVisitId);
  eq("the billing line uses the EXPLICITLY PICKED authorization's service code (S5126), not a guess",
    disambiguatedLine?.serviceCode, 'S5126');
  eq('  ...units computed from the visit duration (120min / 15min unit = 8)', disambiguatedLine?.units, 8);

  // A client with zero or exactly one active authorization is the common
  // case and must stay exactly as simple as before -- no forced picker.
  await query(
    `INSERT INTO referrals (id,organization_id,payer,client_name,dob,service,auth_hours,auth_number,diagnosis,received_date,status)
     VALUES ('rr2',$1,'Medicaid','Single Auth Client','01/01/1955','PAS','20','A','DX','09/01/2026','new')`, [ORG]
  );
  await db.submitIntake(ORG, 'rr2', { clientName: 'Single Auth Client', authHours: '20 hrs/wk', locationId: locId, careNeeds: [] });
  const singleAuthClientId = 'c-rr2';
  const soloVisitId = await db.createVisit(
    ORG, { caregiverId: cg, clientId: singleAuthClientId, day: 'fri', startTime: '9:00 AM', endTime: '10:00 AM' }, locId
  );
  check('a client with ZERO active authorizations schedules fine without a pick (nothing to disambiguate)',
    typeof soloVisitId === 'string' && soloVisitId.length > 0);

  const soloAuthId = await db.createServiceAuthorization(ORG, {
    clientId: singleAuthClientId, payer: 'Medicaid', serviceCode: 'S5128', serviceDescription: 'Solo Service',
    unitMinutes: 15, frequency: 'Weekly', startDate: '09/01/2026', endDate: '12/31/2026',
    status: 'approved', ratePerUnit: 40,
  });
  const soloVisitId2 = await db.createVisit(
    ORG, { caregiverId: cg, clientId: singleAuthClientId, day: 'fri', startTime: '10:00 AM', endTime: '11:00 AM' }, locId
  );
  check('with exactly ONE active authorization, createVisit still does not require an explicit pick',
    typeof soloVisitId2 === 'string' && soloVisitId2.length > 0);
  // The API leaves the pick optional and null here (the schedule-a-visit UI
  // pre-fills it for the user in this single-authorization case via its
  // defaultValue -- see components/admin/ScheduleClient.js). Either way,
  // billing must still resolve correctly: with only one approved
  // authorization on file, generateBillingLineForVisit's fallback guess is
  // no longer a guess -- there's nothing else it could be.
  await db.clockIn(ORG, soloVisitId2, locId);
  await db.clockOut(ORG, soloVisitId2, locId);
  const soloLineId = await db.getBillingLineByVisit(ORG, soloVisitId2);
  check('clockOut generated a billing line for the unambiguous single-authorization visit', soloLineId !== null);
  const allLinesAfterSolo = await db.getBillingLines(ORG);
  const soloLine = allLinesAfterSolo.find((l) => l.visitId === soloVisitId2);
  eq("with only one authorization on file, the fallback guess still lands on the right service code (S5128)",
    soloLine?.serviceCode, 'S5128');

  console.log('\n== unrated authorization: revenue must NOT silently count as $0 ==');
  // NOTE: by this point in the file the same location/org also carries the
  // disambiguated visit (8 units x $25 = $200, on explicitUnitsAuthId) and
  // the solo-authorization visit (4 units x $40 = $160, on soloAuthId) added
  // by the billing-ambiguity-fix tests above -- this block used to assume
  // it was the only billing activity in the fixture and asserted the whole
  // location's revenue/ratedLineCount went to exactly 0, which stopped being
  // true the moment those tests started sharing this location. The correct
  // assertion is that removing THIS ONE authorization's rate demotes only
  // ITS line (240 = 8 units x $30) to unrated, leaving the other two
  // untouched -- not that it zeroes out the whole location.
  const beforeNoRate = await db.getLocationRevenueSummary(ORG);
  await query(`UPDATE service_authorizations SET rate_per_unit = NULL WHERE id = $1`, [authId]);
  const noRate = await db.getLocationRevenueSummary(ORG);
  eq('revenue drops by exactly this authorization\'s own billed amount ($240), not to 0',
    noRate[0].revenue, beforeNoRate[0].revenue - 240);
  eq('the line is now reported as unrated', noRate[0].unratedLineCount, beforeNoRate[0].unratedLineCount + 1);
  eq('and no longer counted as rated (only this line, not the other authorizations\' lines)',
    noRate[0].ratedLineCount, beforeNoRate[0].ratedLineCount - 1);

  console.log('\n== flexible-hours grace-period check (per-org configurator setting, added 2026-09-23) ==');
  // Separate org from ORG above so this feature's default (false) and its
  // on/off behavior can be exercised without touching the assertions above,
  // which predate this feature and explicitly opt out of it.
  const FH_ORG = 'org-fh';
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Flexible Hours QA Agency','active')`, [FH_ORG]);

  const fhDefaults = await db.getOrganization(FH_ORG);
  eq('flexible_hours_enabled defaults to false (opt-in -- see the migration file for why: ' +
    'it changes how every clock-out is judged, so each agency turns it on deliberately)',
    fhDefaults.flexibleHoursEnabled, false);
  eq('flexible_hours_grace_minutes defaults to 20', fhDefaults.flexibleHoursGraceMinutes, 20);

  const fhCg = await db.createCaregiverWithLogin(FH_ORG, {
    name: 'FH CG', role: 'Aide', phone: '1', email: 'fh@x.test', passwordHash: 'x',
  });
  await query(
    `INSERT INTO referrals (id,organization_id,payer,client_name,dob,service,auth_hours,auth_number,diagnosis,received_date,status)
     VALUES ('fh-r1',$1,'Medicaid','FH Client','01/01/1950','PAS','20','A','DX','09/01/2026','new')`, [FH_ORG]
  );
  await db.submitIntake(FH_ORG, 'fh-r1', { clientName: 'FH Client', authHours: '20 hrs/wk', careNeeds: [] });
  const fhClientId = 'c-fh-r1';

  // Scheduled two days ago, so its scheduled end is well past any grace
  // period when it's clocked out now (real calendar since 2026-09-24).
  const fhLateVisitId = await db.createVisit(
    FH_ORG, { caregiverId: fhCg, clientId: fhClientId, serviceDate: addDays(todayIso(), -2), startTime: '9:00 AM', endTime: '11:00 AM' }
  );

  await db.clockIn(FH_ORG, fhLateVisitId);
  await db.clockOut(FH_ORG, fhLateVisitId);
  const disabledResult = await db.getVisit(FH_ORG, fhLateVisitId);
  eq('disabled (the default): a way-late clock-out is still marked resolved', disabledResult.resolved, true);
  eq('  ...and carries no exception code', disabledResult.evv?.exception, null);

  await db.updateOrganizationFlexibleHours(FH_ORG, { enabled: true, graceMinutes: 20 });
  const fhLateVisitId2 = await db.createVisit(
    FH_ORG, { caregiverId: fhCg, clientId: fhClientId, serviceDate: addDays(todayIso(), -1), startTime: '9:00 AM', endTime: '11:00 AM' }
  );
  await db.clockIn(FH_ORG, fhLateVisitId2);
  await db.clockOut(FH_ORG, fhLateVisitId2);
  const enabledResult = await db.getVisit(FH_ORG, fhLateVisitId2);
  eq('enabled: a clock-out well past the grace period raises reason code 110A',
    enabledResult.evv?.exception, '110A');
  eq('  ...and is left UNresolved so it surfaces as an open exception on /admin/evv',
    enabledResult.resolved, false);
  check('  ...and a human-readable note explains why',
    typeof enabledResult.evv?.note === 'string' && enabledResult.evv.note.includes('grace period'),
    `got ${JSON.stringify(enabledResult.evv?.note)}`);

  // A visit whose scheduled end is genuinely still in the future.
  await query(
    `INSERT INTO visits (id,organization_id,caregiver_id,client_id,day,service_date,start_time,end_time,status)
     VALUES ('fh-future1',$1,$2,$3,null,'2099-12-31','9:00 AM','11:59 PM','scheduled')`,
    [FH_ORG, fhCg, fhClientId]
  );
  await db.clockIn(FH_ORG, 'fh-future1');
  await db.clockOut(FH_ORG, 'fh-future1');
  const futureResult = await db.getVisit(FH_ORG, 'fh-future1');
  eq('a clock-out well within a still-future scheduled end raises no exception',
    futureResult.evv?.exception, null);
  eq('  ...and is marked resolved as normal', futureResult.resolved, true);

  await db.updateOrganizationFlexibleHours(FH_ORG, { enabled: false, graceMinutes: 45 });
  const afterUpdate = await db.getOrganization(FH_ORG);
  eq('updateOrganizationFlexibleHours: enabled round-trips', afterUpdate.flexibleHoursEnabled, false);
  eq('  ...graceMinutes round-trips', afterUpdate.flexibleHoursGraceMinutes, 45);
  await throws('rejects a negative grace period', () =>
    db.updateOrganizationFlexibleHours(FH_ORG, { enabled: true, graceMinutes: -5 }), 'whole number');
  await throws('rejects a grace period over 480 minutes', () =>
    db.updateOrganizationFlexibleHours(FH_ORG, { enabled: true, graceMinutes: 1000 }), 'whole number');
  await throws('rejects a non-numeric grace period', () =>
    db.updateOrganizationFlexibleHours(FH_ORG, { enabled: true, graceMinutes: 'lots' }), 'whole number');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`REGRESSION RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
