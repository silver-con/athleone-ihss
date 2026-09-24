// QA for the EVV Export page's data layer (2026-09-24): export state
// precedence, the visit list (closed visits only, location scoped), queueing
// with skip reasons, office hold / release and the sync queue honouring it,
// and the EVV payload using the authorization picked at scheduling.
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { exportState, EXPORT_STATES, EXPORT_STATE_ORDER } from './evv-export.js';
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

const ORG = 'org-ex';
const OTHER = 'org-ex2';

async function addVisit(id, clientId, status, { daysAgo = 1, exception = null, resolved = true, authId = null } = {}) {
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved, evv_exception,
                         evv_clock_in, evv_clock_out, service_authorization_id)
     VALUES ($1,$2,'cg-ex',$3,$4,'9:00 AM','11:00 AM',$5,$6,$7,$8,$9,$10)`,
    [id, ORG, clientId, addDays(todayIso(), -daysAgo), status, resolved, exception,
      status === 'completed' ? '9:00 AM' : null, status === 'completed' ? '11:00 AM' : null, authId]
  );
}
const syncRows = (visitId) => query(`SELECT * FROM evv_sync_log WHERE organization_id = $1 AND visit_id = $2 ORDER BY created_at`, [ORG, visitId]);

async function run() {
  console.log('\n== export state precedence ==');
  const v = (extra = {}) => ({ resolved: true, evv: {}, exportHold: null, ...extra });
  eq('an open exception comes first', exportState({ visit: v({ resolved: false, evv: { exception: '110A' } }), latestSync: { status: 'acknowledged' } }).key, 'needs_maintenance');
  eq('then a hold', exportState({ visit: v({ exportHold: { reason: 'checking timesheet' } }), latestSync: null, problems: ['x'] }).key, 'on_hold');
  eq('  ...carrying its reason', exportState({ visit: v({ exportHold: { reason: 'checking timesheet' } }) }).detail, 'checking timesheet');
  eq('accepted by the state', exportState({ visit: v(), latestSync: { status: 'acknowledged' } }).key, 'accepted');
  eq('sent, awaiting the state', exportState({ visit: v(), latestSync: { status: 'sent' } }).key, 'sent');
  const rej = exportState({ visit: v(), latestSync: { status: 'failed', lastError: 'Invalid Medicaid ID' } });
  eq('rejected, with the state\'s reason', [rej.key, rej.detail], ['rejected', 'Invalid Medicaid ID']);
  eq('missing data blocks a queued visit', exportState({ visit: v(), latestSync: { status: 'pending', attempts: 0 }, problems: ['no Medicaid ID'] }).key, 'blocked');
  eq('a clean queued visit is queued', exportState({ visit: v(), latestSync: { status: 'pending', attempts: 0 } }).key, 'queued');
  check('  ...and shows retries', /attempt 3/.test(exportState({ visit: v(), latestSync: { status: 'pending', attempts: 2 } }).detail || ''));
  eq('never queued and clean', exportState({ visit: v(), latestSync: null }).key, 'not_queued');
  eq('never queued but missing data', exportState({ visit: v(), latestSync: null, problems: ['p'] }).key, 'blocked');
  check('every state has a label and a place in the order', EXPORT_STATE_ORDER.every((k) => EXPORT_STATES[k]?.label) && EXPORT_STATE_ORDER.length === Object.keys(EXPORT_STATES).length);

  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Export Agency','active'),($2,'Other','active')`, [ORG, OTHER]);
  const north = await db.createLocation(ORG, { name: 'North' });
  const south = await db.createLocation(ORG, { name: 'South' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('cg-ex',$1,'Cam','Aide','5550000000','active',$2)`, [ORG, north]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES ('c-ex1',$1,'Ann','Molina','10','09/01/2026',$2,'999000301')`, [ORG, north]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ('c-ex2',$1,'Ben','Molina','10','09/01/2026',$2)`, [ORG, north]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES ('c-ex3',$1,'Cy','Molina','10','09/01/2026',$2,'999000302')`, [ORG, south]);
  const actor = { userId: await db.createOrgUser(ORG, { name: 'Ed Export', email: 'ed@ex.test', role: 'ADMIN', passwordHash: 'x' }), name: 'Ed Export', role: 'ADMIN', locationId: null };

  await addVisit('e1', 'c-ex1', 'completed');
  await addVisit('e2', 'c-ex1', 'completed', { exception: '110A', resolved: false });
  await addVisit('e3', 'c-ex1', 'missed');
  await addVisit('e4', 'c-ex1', 'scheduled');
  await addVisit('e5', 'c-ex2', 'completed');
  await addVisit('e6', 'c-ex3', 'completed');
  await addVisit('e-old', 'c-ex1', 'completed', { daysAgo: 40 });

  console.log('\n== the visit list ==');
  const range = { from: addDays(todayIso(), -7), to: todayIso() };
  const all = await db.getVisitExportRows(ORG, range);
  eq('only finished (completed or missed) visits in the date range', all.map((r) => r.visit.id).sort(), ['e1', 'e2', 'e3', 'e5', 'e6']);
  eq('  ...with names joined', all.find((r) => r.visit.id === 'e1').clientName, 'Ann');
  eq('  ...and no sync row yet', all.find((r) => r.visit.id === 'e1').latestSync, null);
  eq('a location admin sees only their location', (await db.getVisitExportRows(ORG, range, south)).map((r) => r.visit.id), ['e6']);
  eq('another agency sees none of it', (await db.getVisitExportRows(OTHER, range)).length, 0);

  console.log('\n== queueing for export ==');
  await throws('nothing selected is refused', () => db.queueVisitsForExport(ORG, [], actor), 'at least one');
  await throws('more than 200 at once is refused', () => db.queueVisitsForExport(ORG, Array.from({ length: 201 }, (_, i) => `x${i}`), actor), 'at most 200');
  const q1 = await db.queueVisitsForExport(ORG, ['e1', 'e2', 'e4', 'e1'], actor);
  eq('a clean finished visit is queued (duplicates ignored)', q1.queued, ['e1']);
  eq('  ...an open exception and an unfinished visit are skipped with reasons',
    q1.skipped.map((s) => [s.id, s.reason]), [['e2', 'open exception — needs visit maintenance'], ['e4', 'not finished yet']]);
  eq('  ...as a first send (visit_create)', (await syncRows('e1')).map((r) => [r.operation, r.status]), [['visit_create', 'pending']]);
  check('  ...and it is audited', (await db.getAuditLog(ORG)).some((a) => a.action === 'evv_export_queue'));
  await db.queueVisitsForExport(ORG, ['e1'], actor);
  eq('queueing again does not stack a duplicate', (await syncRows('e1')).length, 1);
  eq('the list now shows it queued', (await db.getVisitExportRows(ORG, range)).find((r) => r.visit.id === 'e1').latestSync.status, 'pending');
  await throws("a location admin can't queue another location's visit", () => db.queueVisitsForExport(ORG, ['e1'], { ...actor, locationId: south }), 'not found');
  await throws("another agency can't queue it", () => db.queueVisitsForExport(OTHER, ['e1'], actor), 'not found');

  console.log('\n== hold and release ==');
  const dueIds = async () => (await db.getSyncRowsDue(ORG, 50)).map((r) => r.visitId);
  check('before a hold, the queued visit is due to send', (await dueIds()).includes('e1'));
  await throws('a hold needs a reason', () => db.setVisitsExportHold(ORG, ['e1'], true, '  ', actor), 'Say why');
  eq('holding a visit', await db.setVisitsExportHold(ORG, ['e1'], true, 'Checking the paper timesheet', actor), ['e1']);
  const held = await db.getVisit(ORG, 'e1');
  eq('  ...records who and why', [held.exportHold?.reason, held.exportHold?.by], ['Checking the paper timesheet', 'Ed Export']);
  check('  ...and the sender skips it', !(await dueIds()).includes('e1'));
  eq('  ...its queued row stays pending (not failed)', (await syncRows('e1'))[0].status, 'pending');
  eq('holding it again changes nothing', await db.setVisitsExportHold(ORG, ['e1'], true, 'again', actor), []);
  const q2 = await db.queueVisitsForExport(ORG, ['e1'], actor);
  eq('a held visit is not queued', q2.skipped.map((s) => s.reason), ['on hold']);
  await throws("a location admin can't hold another location's visit", () => db.setVisitsExportHold(ORG, ['e1'], false, null, { ...actor, locationId: south }), 'not found');
  eq('releasing it', await db.setVisitsExportHold(ORG, ['e1'], false, null, actor), ['e1']);
  eq('  ...clears the hold', (await db.getVisit(ORG, 'e1')).exportHold, null);
  check('  ...and it is due to send again', (await dueIds()).includes('e1'));
  const actions = (await db.getAuditLog(ORG)).map((a) => a.action);
  check('hold and release are both audited', actions.includes('evv_export_hold') && actions.includes('evv_export_release'));

  console.log('\n== re-sending after the state accepted a visit ==');
  await query(`UPDATE evv_sync_log SET status = 'acknowledged' WHERE organization_id = $1 AND visit_id = 'e1'`, [ORG]);
  await db.queueVisitsForExport(ORG, ['e1'], actor);
  eq('a visit the state already has is re-sent as an update', (await syncRows('e1')).map((r) => r.operation), ['visit_create', 'visit_update']);
  eq('the list reports its LATEST sync row', (await db.getVisitExportRows(ORG, range)).find((r) => r.visit.id === 'e1').latestSync.operation, 'visit_update');

  console.log('\n== the payload uses the authorization picked at scheduling ==');
  const picked = await db.createServiceAuthorization(ORG, {
    clientId: 'c-ex1', payer: 'Molina', serviceCode: 'S5125', serviceDescription: 'PAS', startDate: addDays(todayIso(), -60), endDate: addDays(todayIso(), 30), status: 'approved',
  });
  await db.createServiceAuthorization(ORG, {
    clientId: 'c-ex1', payer: 'Molina', serviceCode: 'S5126', serviceDescription: 'Respite', startDate: addDays(todayIso(), -60), endDate: addDays(todayIso(), 300), status: 'approved',
  });
  await addVisit('e7', 'c-ex1', 'completed', { authId: picked });
  const ctx = await db.loadVisitExportContext(ORG, 'e7');
  eq('the picked authorization (S5125) wins over the longer-running one', ctx.authorization?.serviceCode, 'S5125');
  eq('  ...with the client and caregiver loaded', [ctx.client?.id, ctx.caregiver?.id], ['c-ex1', 'cg-ex']);
  eq('an unknown visit has no context', await db.loadVisitExportContext(ORG, 'nope'), null);
  eq('another agency gets no context', await db.loadVisitExportContext(OTHER, 'e7'), null);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`EVV EXPORT RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
