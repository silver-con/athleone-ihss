// QA for 110 B downward bill-hours adjustments (2026-09-24): billable time
// can only go down, needs 110 B, is recorded before/after in the visit
// maintenance log, and flows into a draft billing line but never into one
// already submitted to the payer.
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { todayIso, addDays } from './calendar.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-bh';
const base = { contact: 'caregiver', reasonCodes: ['110B'], verified: true };
const line = (visitId) => queryOne('SELECT units, status, notes FROM billing_lines WHERE organization_id = $1 AND visit_id = $2', [ORG, visitId]);

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Bill Agency','active')`, [ORG]);
  const loc = await db.createLocation(ORG, { name: 'Main' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('cg-bh',$1,'Cam','Aide','5550000000','active',$2)`, [ORG, loc]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES ('c-bh',$1,'Bea','Molina','10','09/01/2026',$2,'999000401')`, [ORG, loc]);
  const actor = { userId: await db.createOrgUser(ORG, { name: 'Bo Biller', email: 'bo@bh.test', role: 'ADMIN', passwordHash: 'x' }), name: 'Bo Biller', role: 'ADMIN', locationId: null };
  const date = addDays(todayIso(), -2);
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved, evv_clock_in, evv_clock_out, evv_exception)
     VALUES ('b1',$1,'cg-bh','c-bh',$2,'9:00 AM','1:00 PM','completed',false,'9:00 AM','12:30 PM','110A')`,
    [ORG, date]
  );
  await db.createBillingLine(ORG, { clientId: 'c-bh', visitId: 'b1', serviceCode: 'S5125', units: 16, serviceDate: date, status: 'pending' });

  console.log('\n== what a visit bills for ==');
  eq('with no adjustment, the scheduled 4 hours', db.billableMinutes(await db.getVisit(ORG, 'b1')), 240);

  console.log('\n== the rules ==');
  await throws('changing billable time without 110 B is refused', () => db.performVisitMaintenance(ORG, 'b1', { ...base, reasonCodes: ['110A'], billHours: '3' }, actor), 'needs reason code 110 B');
  await throws('110 B without a new figure is refused', () => db.performVisitMaintenance(ORG, 'b1', base, actor), 'more than zero');
  await throws('110 B cannot RAISE billable time', () => db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '5' }, actor), 'only lowers');
  await throws('110 B cannot keep it the same', () => db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '4', billMinutes: '0' }, actor), 'only lowers');
  await throws('minutes must be 0-59', () => db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '3', billMinutes: '75' }, actor), '0-59');
  await throws('fractions are refused', () => db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '3.5' }, actor), 'whole hours');
  eq('  ...and nothing changed', [(await db.getVisit(ORG, 'b1')).billMinutes, (await line('b1')).units], [null, '16']);

  console.log('\n== a valid downward adjustment ==');
  const r1 = await db.performVisitMaintenance(ORG, 'b1', { ...base, reasonCodes: ['110A', '110B'], billHours: '3', billMinutes: '30', note: 'Left 30 min early.' }, actor);
  const v1 = await db.getVisit(ORG, 'b1');
  eq('billable time is now 3h 30m', [v1.billMinutes, db.billableMinutes(v1)], [210, 210]);
  eq('  ...the exception is resolved', v1.resolved, true);
  const h1 = (await db.getVisitMaintenanceHistory(ORG, 'b1'))[0];
  eq('  ...history records before and after', [h1.billMinutesBefore, h1.billMinutesAfter], [240, 210]);
  eq('  ...the draft billing line is lowered to 14 units (15-min units)', (await line('b1')).units, '14');
  check('  ...with a note on the line', /110 B/.test((await line('b1')).notes || ''));
  eq('  ...and the caller is told', r1.billing, { updated: true, units: 14, status: 'pending' });
  check('  ...and the audit log records the change', (await db.getAuditLog(ORG)).some((a) => a.action === 'visit_maintenance' && /bill time 240 -> 210/.test(a.detail || '')));

  await db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '3' }, actor);
  eq('a second adjustment lowers from the ADJUSTED figure', (await db.getVisitMaintenanceHistory(ORG, 'b1'))[0].billMinutesBefore, 210);
  eq('  ...to 12 units', (await line('b1')).units, '12');
  await throws('  ...and still cannot go back up', () => db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '3', billMinutes: '15' }, actor), 'only lowers');

  console.log('\n== a line already sent to the payer is left alone ==');
  await query(`UPDATE billing_lines SET status = 'submitted' WHERE organization_id = $1 AND visit_id = 'b1'`, [ORG]);
  const r2 = await db.performVisitMaintenance(ORG, 'b1', { ...base, billHours: '2' }, actor);
  eq('the visit is still adjusted', (await db.getVisit(ORG, 'b1')).billMinutes, 120);
  eq('  ...but the submitted line keeps its units', (await line('b1')).units, '12');
  eq('  ...and the caller is told to correct it with the payer', r2.billing, { updated: false, status: 'submitted' });

  console.log('\n== a new billing line uses the adjusted figure ==');
  // The clock-in timestamp is pinned to 9:00 AM Central on the service
  // date. It used to be now() - 2 days, which put the clock-in at whatever
  // time of day the suite happened to run — after 11:00 AM the 11:00
  // clock-out below was "before" it and the suite failed.
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, evv_clock_in, evv_clock_in_at)
     VALUES ('b2',$1,'cg-bh','c-bh',$2,'9:00 AM','1:00 PM','in-progress','9:00 AM', ($3::date + time '09:00') AT TIME ZONE 'America/Chicago')`,
    [ORG, date, date]
  );
  await db.performVisitMaintenance(ORG, 'b2', { ...base, reasonCodes: ['210A', '110B'], manualClockOut: '11:00', billHours: '2' }, actor);
  eq('entering the missing clock-out + 110 B in one go completes the visit', (await db.getVisit(ORG, 'b2')).status, 'completed');
  eq('  ...and its new billing line bills the adjusted 2 hours (8 units)', (await line('b2')).units, '8');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`BILL HOURS RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
