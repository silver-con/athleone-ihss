// QA for audited visit maintenance (2026-09-23): the HHSC reason-code
// table, the maintenance window (state 95 days, agency may shorten), the
// contact -> document -> verify rules, entering ONLY missing clock times,
// the VMUR record once a visit is locked, audit/sync/billing side effects,
// and tenant/location scoping.
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { toUtcIso } from './evv-mapping.js';
import {
  getComplianceProfile, getReasonCodeInfo, selectableReasonCodes, getAggregatorReasonMap, mapReasonCodeForAggregator,
} from './state-compliance.js';

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

const ORG = 'org-vm';
const OTHER = 'org-vm2';
const ACTOR = { userId: null, name: 'Vera Admin', role: 'ADMIN', locationId: null };

function centralIso(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
async function addVisit(id, { daysAgo, status, clockIn = null, clockOut = null, exception = null, resolved = true }) {
  const date = centralIso(-daysAgo);
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status, resolved,
                         evv_clock_in, evv_clock_in_at, evv_clock_out, evv_clock_out_at, evv_exception, evv_method)
     VALUES ($1,$2,'cg-vm','c-vm',NULL,$3,'9:00 AM','1:00 PM',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, ORG, date, status, resolved,
      clockIn, clockIn ? new Date(toUtcIso(date, clockIn) + 'Z') : null,
      clockOut, clockOut ? new Date(toUtcIso(date, clockOut) + 'Z') : null,
      exception, clockIn ? 'GPS mobile check-in' : null]
  );
}
const base = { contact: 'caregiver', reasonCodes: ['110A'], note: '', verified: true };

async function run() {
  const tx = getComplianceProfile('TX');

  console.log('\n== HHSC reason codes (Aug 2023 list) ==');
  const groups = selectableReasonCodes(tx);
  eq('six selectable groups in HHSC order', groups.map((g) => g.group), ['110', '120', '130', '210', '310', '600']);
  eq('110 has sub-codes A-D', groups[0].codes.map((c) => c.code), ['110A', '110B', '110C', '110D']);
  eq('210 has sub-codes A-J', groups[3].codes.length, 10);
  const needNote = Object.entries(tx.reasonCodes).filter(([, i]) => i.requiresNote && i.selectable !== false).map(([c]) => c);
  eq('free text is required for exactly 210 I and 600 (HHSC §10000)', needNote.sort(), ['210I', '600']);
  check('000 (overnight) is system-only, not selectable', !groups.some((g) => g.codes.some((c) => c.code === '000')));
  check('a legacy bare code still displays (210)', /No Electronic Clock/.test(getReasonCodeInfo(tx, '210')?.label || ''));
  check('an unknown sub-code falls back to its group for display', /Disaster/.test(getReasonCodeInfo(tx, '130Z')?.label || ''));
  const hhax = getAggregatorReasonMap('TX', 'hhaexchange');
  eq('aggregator: 210 A falls back to the 210 mapping', mapReasonCodeForAggregator(hhax, '210A')?.reasonCode, '210');
  eq('aggregator: 210 I keeps its own mapping', mapReasonCodeForAggregator(hhax, '210I')?.reasonCode, '218');
  eq('aggregator: 110 D is the overlapping-visits mapping', mapReasonCodeForAggregator(hhax, '110D')?.reasonCode, '212');

  await query(`INSERT INTO organizations (id,name,status,state) VALUES ($1,'Maint Agency','active','TX'),($2,'Other','active','TX')`, [ORG, OTHER]);
  const loc = await db.createLocation(ORG, { name: 'North' });
  const otherLoc = await db.createLocation(ORG, { name: 'South' });
  // audit_log.actor_user_id references users(id), so the actor must be real.
  ACTOR.userId = await db.createOrgUser(ORG, { name: 'Vera Admin', email: 'vera@vm.test', role: 'ADMIN', passwordHash: 'x' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('cg-vm',$1,'Cam Care','Aide','5550000000','active',$2)`, [ORG, loc]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES ('c-vm',$1,'Cora Client','Molina','10','09/01/2026',$2,'999000111')`, [ORG, loc]);

  console.log('\n== maintenance window ==');
  let org = await db.getOrganization(ORG);
  eq('Texas default is 95 days', db.getMaintenanceWindowDays(org), 95);
  await throws('an agency cannot set a deadline LONGER than the state\'s', () => db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: 96 }), "can't be longer");
  await throws('a non-number deadline is refused', () => db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: '3.5' }), 'whole number');
  await db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: 95 });
  eq('setting exactly the state\'s 95 stores "use the state window" (null)', (await db.getOrganization(ORG)).visitMaintenanceWindowDays, null);
  await db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: true, graceMinutes: 30, maintenanceWindowDays: 30 });
  org = await db.getOrganization(ORG);
  eq('a shorter internal deadline is saved', db.getMaintenanceWindowDays(org), 30);
  eq('  ...and the flexible-hours fields saved alongside it', [org.flexibleHoursEnabled, org.flexibleHoursGraceMinutes], [true, 30]);
  await throws('grace minutes are still validated', () => db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: true, graceMinutes: 999, maintenanceWindowDays: '' }), 'Grace period');

  await addVisit('v-late', { daysAgo: 40, status: 'completed', clockIn: '9:00 AM', clockOut: '1:00 PM', exception: '110A', resolved: false });
  const late = await db.getVisit(ORG, 'v-late');
  check('with a 30-day deadline, a 40-day-old visit is locked', db.getMaintenanceStatus(org, late).locked);
  await db.updateOrganizationEvvSettings(ORG, { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: '' });
  org = await db.getOrganization(ORG);
  check('back on the state window, the same visit is open again', !db.getMaintenanceStatus(org, late).locked);
  eq('  ...with 55 days left', db.getMaintenanceStatus(org, late).daysRemaining, 55);

  console.log('\n== contact -> document -> verify rules ==');
  await addVisit('v1', { daysAgo: 2, status: 'completed', clockIn: '9:00 AM', clockOut: '1:40 PM', exception: '110A', resolved: false });
  await throws('contact is required', () => db.performVisitMaintenance(ORG, 'v1', { ...base, contact: '' }, ACTOR), 'who you contacted');
  await throws('at least one reason code is required', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: [] }, ACTOR), 'at least one reason code');
  await throws('000 cannot be chosen', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['000'] }, ACTOR), "isn't a reason code you can select");
  await throws('a made-up code is refused', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['999'] }, ACTOR), "isn't a reason code");
  await throws('more than three codes is refused', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['110A', '110B', '110C', '110D'] }, ACTOR), 'at most 3');
  await throws('600 without a note is refused', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['600'] }, ACTOR), '600 requires a note');
  await throws('210 I without a note is refused', () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['210I'] }, ACTOR), '210 I requires a note');
  await throws('the verify step is required', () => db.performVisitMaintenance(ORG, 'v1', { ...base, verified: false }, ACTOR), 'verified the services');
  await throws("a RECORDED clock-out can't be overwritten (HHSC §9000)", () => db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['210A'], manualClockOut: '13:00' }, ACTOR), "doesn't allow recorded clock times to be changed");
  eq('  ...and nothing was written by any refused attempt', (await db.getVisitMaintenanceHistory(ORG, 'v1')).length, 0);

  const r1 = await db.performVisitMaintenance(ORG, 'v1', { ...base, reasonCodes: ['110a', '110A'], note: 'Client asked to stay later.' }, ACTOR);
  const v1 = await db.getVisit(ORG, 'v1');
  eq('a valid entry resolves the exception', v1.resolved, true);
  eq('  ...keeps the reason code on the visit (deduped, upper-cased)', v1.evv.exception, '110A');
  eq('  ...stores the note', v1.evv.note, 'Client asked to stay later.');
  eq('  ...does not complete an already-completed visit again', r1.completedNow, false);
  const h1 = await db.getVisitMaintenanceHistory(ORG, 'v1');
  eq('one history row', h1.length, 1);
  eq('  ...recording who did it', h1[0].performedByName, 'Vera Admin');
  eq('  ...who they contacted', h1[0].contact, 'caregiver');
  eq('  ...and the codes', h1[0].reasonCodes, ['110A']);
  check('an audit-log row is written', (await db.getAuditLog(ORG)).some((a) => a.action === 'visit_maintenance' && a.entityId === 'v1'));
  check('the corrected visit is queued for the state aggregator',
    (await queryOne(`SELECT count(*)::int AS n FROM evv_sync_log WHERE organization_id = $1 AND visit_id = 'v1' AND operation = 'visit_update'`, [ORG])).n >= 1);

  console.log('\n== entering a missing clock time ==');
  await addVisit('v2', { daysAgo: 1, status: 'in-progress', clockIn: '9:00 AM' });
  await throws('a missing clock-out must be entered', () => db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['210A'] }, ACTOR), 'no clock-out');
  await throws('entering a time needs a 210 code', () => db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['110A'], manualClockOut: '13:00' }, ACTOR), 'needs a 210 reason code');
  await throws('a clock-out before the clock-in is refused', () => db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['210A'], manualClockOut: '08:00' }, ACTOR), 'split at midnight');
  await throws('a malformed time is refused', () => db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['210A'], manualClockOut: '25:00' }, ACTOR), 'HH:MM');
  await throws("a clock-in can't be added where one was recorded", () => db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['210A'], manualClockIn: '08:30', manualClockOut: '13:00' }, ACTOR), "doesn't allow recorded clock times");
  const r2 = await db.performVisitMaintenance(ORG, 'v2', { ...base, reasonCodes: ['210A'], manualClockOut: '13:00' }, ACTOR);
  const v2 = await db.getVisit(ORG, 'v2');
  eq('the missing clock-out completes the visit', v2.status, 'completed');
  eq('  ...reported as completed now', r2.completedNow, true);
  eq('  ...with the entered time', v2.evv.clockOut, '1:00 PM');
  eq('  ...and the recorded clock-in untouched', v2.evv.clockIn, '9:00 AM');
  check('  ...and the method says the clock-out was manual', /manual clock-out/.test(v2.evv.method || ''), v2.evv.method);
  eq('  ...history records the manual time', (await db.getVisitMaintenanceHistory(ORG, 'v2'))[0].manualClockOutAt !== null, true);
  check('  ...and a billing line was drafted (EVV not live)', (await db.getBillingLineByVisit(ORG, 'v2')) !== null);

  await addVisit('v3', { daysAgo: 3, status: 'scheduled' });
  await throws('a visit with no clock times needs both', () => db.performVisitMaintenance(ORG, 'v3', { ...base, reasonCodes: ['210B'], manualClockOut: '13:00' }, ACTOR), 'no clock-in');
  await db.performVisitMaintenance(ORG, 'v3', { ...base, reasonCodes: ['210B'], manualClockIn: '09:05', manualClockOut: '13:10' }, ACTOR);
  const v3 = await db.getVisit(ORG, 'v3');
  eq('both times entered -> completed', [v3.status, v3.evv.clockIn, v3.evv.clockOut], ['completed', '9:05 AM', '1:10 PM']);
  eq('  ...method is manual entry', v3.evv.method, 'Manual entry (visit maintenance)');

  await addVisit('v-missed', { daysAgo: 2, status: 'missed', exception: '600', resolved: false });
  await db.performVisitMaintenance(ORG, 'v-missed', { contact: 'client', reasonCodes: ['600'], note: 'Client was in hospital; no service delivered.', verified: true }, ACTOR);
  const vm = await db.getVisit(ORG, 'v-missed');
  eq('a missed visit can be documented without clock times', [vm.status, vm.resolved], ['missed', true]);

  await addVisit('v-future', { daysAgo: -2, status: 'scheduled' });
  await throws("a visit that hasn't happened can't be maintained", () => db.performVisitMaintenance(ORG, 'v-future', { ...base, reasonCodes: ['210A'], manualClockIn: '09:00', manualClockOut: '10:00' }, ACTOR), "hasn't happened yet");

  console.log('\n== locked visits and VMUR ==');
  await addVisit('v-old', { daysAgo: 100, status: 'completed', clockIn: '9:00 AM', clockOut: '1:00 PM', exception: '110A', resolved: false });
  await throws('a visit past 95 days is locked', () => db.performVisitMaintenance(ORG, 'v-old', base, ACTOR), 'past the 95-day maintenance window');
  await throws('a VMUR needs a real justification', () => db.recordVisitVmur(ORG, 'v-old', { justification: 'fix' }, ACTOR), 'at least a sentence');
  await db.recordVisitVmur(ORG, 'v-old', { justification: 'Caregiver timesheet shows 4 hours; client confirmed.', payerReference: 'MOL-4471' }, ACTOR);
  const vo = await db.getVisit(ORG, 'v-old');
  eq('the VMUR is recorded on the visit', vo.vmurSubmitted, true);
  eq('  ...the exception stays open until the payer unlocks it', vo.resolved, false);
  const ho = await db.getVisitMaintenanceHistory(ORG, 'v-old');
  eq('  ...with a VMUR history row', [ho[0].kind, ho[0].payerReference], ['vmur', 'MOL-4471']);
  check('  ...and an audit-log row', (await db.getAuditLog(ORG)).some((a) => a.action === 'visit_vmur_recorded' && a.entityId === 'v-old'));
  await throws('a VMUR is refused for a visit still inside the window', () => db.recordVisitVmur(ORG, 'v1', { justification: 'Just because we want to.' }, ACTOR), 'still inside');

  console.log('\n== scoping ==');
  await addVisit('v-scope', { daysAgo: 1, status: 'completed', clockIn: '9:00 AM', clockOut: '1:00 PM', exception: '110A', resolved: false });
  await throws('a location admin from another location cannot maintain this visit', () => db.performVisitMaintenance(ORG, 'v-scope', base, { ...ACTOR, locationId: otherLoc }), 'Visit not found');
  await throws('another agency cannot maintain this visit', () => db.performVisitMaintenance(OTHER, 'v-scope', base, ACTOR), 'Visit not found');
  await throws('another agency cannot read its history either', () => db.getVisitMaintenanceHistory(OTHER, 'v-scope').then((h) => { if (h.length === 0) throw new Error('empty'); }), 'empty');
  await db.performVisitMaintenance(ORG, 'v-scope', base, { ...ACTOR, locationId: loc });
  eq("a location admin in the visit's own location can", (await db.getVisit(ORG, 'v-scope')).resolved, true);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`VISIT MAINTENANCE RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
