// QA for the overlapping-visit check (2026-09-24, Vesta failed-to-export
// rule): same caregiver, overlapping clock times, GPS farther apart than
// the agency threshold -> conflict, unless 110 D is recorded; same-household
// clients, visits without GPS, other caregivers and non-overlapping visits
// never conflict.
import * as db from './queries.js';
import { query, pool } from './db.js';
import { toUtcIso } from './evv-mapping.js';
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

const ORG = 'org-ov';
const DATE = addDays(todayIso(), -1);
const HOME_A = [26.075175, -97.473486];
const HOME_B = [26.075175, -97.470486]; // ~984 ft east of A
const HOME_C = [26.075175, -97.473396]; // ~30 ft from A (same household)

async function visit(id, caregiverId, clientId, start, end, where) {
  const at = (label) => (label ? new Date(toUtcIso(DATE, label) + 'Z') : null);
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved,
                         evv_clock_in, evv_clock_in_at, evv_clock_out, evv_clock_out_at,
                         evv_clock_in_lat, evv_clock_in_lng, evv_clock_out_lat, evv_clock_out_lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',true,$6,$8,$7,$9,$10,$11,$10,$11)`,
    [id, ORG, caregiverId, clientId, DATE, start, end, at(start), at(end), where ? where[0] : null, where ? where[1] : null]
  );
}

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Overlap Agency','active')`, [ORG]);
  const loc = await db.createLocation(ORG, { name: 'Main' });
  for (const cg of ['cg-o1', 'cg-o2']) {
    await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ($1,$2,$1,'Aide','5550000000','active',$3)`, [cg, ORG, loc]);
  }
  for (const [id, name] of [['c-a', 'Ada'], ['c-b', 'Bo'], ['c-c', 'Cy']]) {
    await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ($1,$2,$3,'Molina','10','09/01/2026',$4)`, [id, ORG, name, loc]);
  }
  const actor = { userId: await db.createOrgUser(ORG, { name: 'Ola Office', email: 'ola@ov.test', role: 'ADMIN', passwordHash: 'x' }), name: 'Ola Office', role: 'ADMIN', locationId: null };

  await visit('oA', 'cg-o1', 'c-a', '9:00 AM', '11:00 AM', HOME_A);
  await visit('oB', 'cg-o1', 'c-b', '10:00 AM', '12:00 PM', HOME_B);
  await visit('oC', 'cg-o1', 'c-c', '9:30 AM', '10:30 AM', HOME_C);
  await visit('oD', 'cg-o1', 'c-b', '1:00 PM', '2:00 PM', HOME_B);
  await visit('oE', 'cg-o1', 'c-b', '9:15 AM', '9:45 AM', null);
  await visit('oF', 'cg-o2', 'c-b', '9:00 AM', '11:00 AM', HOME_B);

  console.log('\n== finding conflicts ==');
  const all = await db.getOverlapConflicts(ORG, ['oA', 'oB', 'oC', 'oD', 'oE', 'oF']);
  eq('A conflicts with B (same caregiver, overlapping, ~984 ft apart)', (all.oA || []).map((c) => c.otherVisitId), ['oB']);
  check('  ...with the distance reported', Math.abs(all.oA[0].distanceFt - 984) <= 5, String(all.oA?.[0]?.distanceFt));
  eq('  ...and the other client named', all.oA[0].otherClientName, 'Bo');
  eq('B conflicts with both A and C', (all.oB || []).map((c) => c.otherVisitId).sort(), ['oA', 'oC']);
  eq('C (same household as A) conflicts only with B, never with A', (all.oC || []).map((c) => c.otherVisitId), ['oB']);
  eq('D does not overlap anything', all.oD, undefined);
  eq('E has no GPS, so it cannot be judged and is not flagged', all.oE, undefined);
  eq("F is another caregiver's visit, so it never conflicts", all.oF, undefined);
  eq('no visits asked about, no conflicts', await db.getOverlapConflicts(ORG, []), {});
  eq('another agency sees none', await db.getOverlapConflicts('org-nobody', ['oA']), {});
  const text = db.describeOverlapConflicts(all.oA)[0];
  check('the problem text names the other client, distance and 110 D', /Bo/.test(text) && /984|98\d ft/.test(text) && /110 D/.test(text), text);

  console.log('\n== 110 D clears a legitimate overlap ==');
  await db.performVisitMaintenance(ORG, 'oB', { contact: 'caregiver', reasonCodes: ['110D'], verified: true }, actor);
  const after = await db.getOverlapConflicts(ORG, ['oA', 'oB', 'oC']);
  eq('with 110 D recorded on B, A no longer conflicts', after.oA, undefined);
  eq('  ...nor does B', after.oB, undefined);
  eq('  ...nor C', after.oC, undefined);

  console.log('\n== the agency threshold ==');
  await visit('oG', 'cg-o1', 'c-a', '3:00 PM', '4:00 PM', HOME_A);
  await visit('oH', 'cg-o1', 'c-b', '3:30 PM', '4:30 PM', HOME_B);
  check('at the default 100 ft, G and H conflict', Boolean((await db.getOverlapConflicts(ORG, ['oG'])).oG));
  const base = { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: '' };
  await throws('below 25 ft is refused', () => db.updateOrganizationEvvSettings(ORG, { ...base, overlapDistanceFeet: 24 }), 'between 25 and 1,000');
  await throws('above 1,000 ft is refused', () => db.updateOrganizationEvvSettings(ORG, { ...base, overlapDistanceFeet: 1001 }), 'between 25 and 1,000');
  await db.updateOrganizationEvvSettings(ORG, { ...base, overlapDistanceFeet: 1000 });
  eq('raised to 1,000 ft, the ~984 ft pair no longer conflicts', (await db.getOverlapConflicts(ORG, ['oG'])).oG, undefined);
  eq('  ...and the setting is saved', (await db.getOrganization(ORG)).overlapDistanceFeet, 1000);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`OVERLAP RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
