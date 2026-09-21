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
