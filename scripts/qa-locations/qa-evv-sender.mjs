// End-to-end QA for the EVV sender (2026-09-24): the real lib/evv-sync.js
// processQueue/pollTransactions against the repo's mock HHAeXchange server
// (mocks/hhaexchange-mock.mjs). Covers: a clean visit is sent and accepted;
// missing Medicaid ID is refused locally with a readable reason; the mock
// aggregator's rejection comes back as "rejected"; a held visit is skipped
// until released; overlapping visits at two places are refused; and the
// EVV Export page's states line up with all of it.
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { processQueue, pollTransactions } from './evv-sync.js';
import { encryptSecret } from './secrets.js';
import { exportState } from './evv-export.js';
import { toUtcIso } from './evv-mapping.js';
import { todayIso, addDays } from './calendar.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ORG = 'org-snd';
const PORT = 4000 + Math.floor(Math.random() * 900);
const DATE = addDays(todayIso(), -1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const syncOf = (visitId) => queryOne(
  `SELECT status, last_error FROM evv_sync_log WHERE organization_id = $1 AND visit_id = $2 ORDER BY created_at DESC LIMIT 1`, [ORG, visitId]);

let mock;
async function startMock() {
  mock = spawn(process.execPath, ['hhaexchange-mock.mjs'], { env: { ...process.env, MOCK_EVV_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/nothing`); return; } catch { await sleep(100); }
  }
  throw new Error('mock aggregator did not start');
}

async function visit(id, clientId, start, end, where) {
  const at = (label) => new Date(toUtcIso(DATE, label) + 'Z');
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved,
                         evv_clock_in, evv_clock_in_at, evv_clock_out, evv_clock_out_at, evv_clock_in_lat, evv_clock_in_lng,
                         evv_clock_out_lat, evv_clock_out_lng, evv_method, evv_verified, service_authorization_id)
     VALUES ($1,$2,'cg-snd',$3,$4,$5,$6,'completed',true,$5,$7,$6,$8,$9,$10,$9,$10,'GPS mobile check-in',true,
             (SELECT id FROM service_authorizations WHERE organization_id = $2 AND client_id = $3 LIMIT 1))`,
    [id, ORG, clientId, DATE, start, end, at(start), at(end), where[0], where[1]]
  );
}

async function run() {
  if (!process.env.EVV_CREDENTIALS_KEY) process.env.EVV_CREDENTIALS_KEY = randomBytes(32).toString('hex');
  await startMock();

  await query(`INSERT INTO organizations (id,name,status,state) VALUES ($1,'Sender Agency','active','TX')`, [ORG]);
  const loc = await db.createLocation(ORG, { name: 'Main' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('cg-snd',$1,'Sam Sender','Aide','5550000000','active',$2)`, [ORG, loc]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES ('c-ok',$1,'Olive','Molina','10','09/01/2026',$2,'999000501')`, [ORG, loc]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ('c-noid',$1,'Nell','Molina','10','09/01/2026',$2)`, [ORG, loc]);
  for (const c of ['c-ok', 'c-noid']) {
    await db.createServiceAuthorization(ORG, { clientId: c, payer: 'Molina', serviceCode: 'S5125', serviceDescription: 'PAS', startDate: addDays(todayIso(), -60), endDate: addDays(todayIso(), 60), status: 'approved' });
  }
  await db.upsertEvvCredentials(ORG, {
    apiBaseUrl: `http://127.0.0.1:${PORT}`, apiVersion: '1',
    clientIdEnc: encryptSecret('hearth-test'), clientSecretEnc: encryptSecret('secret'),
    providerTaxId: '12-3456789', officeQualifier: 'NPI', officeIdentifier: '1234567893', payerId: 'MOLINA',
    environment: 'sandbox', aggregator: 'hhaexchange', status: 'testing',
  });
  const actor = { userId: await db.createOrgUser(ORG, { name: 'Sue Office', email: 'sue@snd.test', role: 'ADMIN', passwordHash: 'x' }), name: 'Sue Office', role: 'ADMIN', locationId: null };

  const HERE = [26.075175, -97.473486];
  const FAR = [26.075175, -97.463486]; // ~3,280 ft away
  await visit('s-ok', 'c-ok', '8:00 AM', '9:00 AM', HERE);
  await visit('s-noid', 'c-noid', '9:30 AM', '10:00 AM', HERE);
  await visit('s3-fail', 'c-ok', '10:30 AM', '11:00 AM', HERE);
  await visit('s-held', 'c-ok', '11:30 AM', '12:00 PM', HERE);
  await visit('s-ovA', 'c-ok', '1:00 PM', '3:00 PM', HERE);
  await visit('s-ovB', 'c-ok', '2:00 PM', '4:00 PM', FAR);

  const all = ['s-ok', 's-noid', 's3-fail', 's-held', 's-ovA', 's-ovB'];
  const q = await db.queueVisitsForExport(ORG, all, actor);
  eq('all six finished visits are queued', q.queued.length, 6);
  await db.setVisitsExportHold(ORG, ['s-held'], true, 'Waiting on timesheet', actor);

  console.log('\n== sending ==');
  const send = await processQueue(ORG, { limit: 50 });
  check('the sender ran against the mock aggregator', send.skipped === false, JSON.stringify(send));
  eq('a clean visit is sent', (await syncOf('s-ok')).status, 'sent');
  const noid = await syncOf('s-noid');
  eq('a client with no Medicaid ID is refused locally', noid.status, 'failed');
  check('  ...with a readable reason', /no Medicaid ID on file/.test(noid.last_error || ''), noid.last_error);
  eq('a visit the mock will reject is still sent (the state decides)', (await syncOf('s3-fail')).status, 'sent');
  eq('a HELD visit is skipped and stays queued', (await syncOf('s-held')).status, 'pending');
  const ovA = await syncOf('s-ovA');
  eq('overlapping visits at two places are refused', [ovA.status, (await syncOf('s-ovB')).status], ['failed', 'failed']);
  check('  ...naming the overlap and 110 D', /overlaps the caregiver's visit/.test(ovA.last_error || '') && /110 D/.test(ovA.last_error || ''), ovA.last_error);

  console.log('\n== the state responds ==');
  await sleep(1400);
  const poll = await pollTransactions(ORG, { limit: 50 });
  check('polling checked the sent transactions', poll.checked >= 2, JSON.stringify(poll));
  eq('the clean visit is accepted', (await syncOf('s-ok')).status, 'acknowledged');
  const rej = await syncOf('s3-fail');
  eq('the mock rejection comes back as failed', rej.status, 'failed');
  check('  ...with the aggregator\'s message', /simulated validation failure/.test(rej.last_error || ''), rej.last_error);

  console.log('\n== releasing the hold ==');
  await db.setVisitsExportHold(ORG, ['s-held'], false, null, actor);
  await processQueue(ORG, { limit: 50 });
  eq('once released, the held visit is sent', (await syncOf('s-held')).status, 'sent');

  console.log('\n== the EVV Export page states line up ==');
  const rows = await db.getVisitExportRows(ORG, { from: DATE, to: DATE });
  // The page re-runs the checks for locally refused visits; mirror that.
  const conflicts = await db.getOverlapConflicts(ORG, rows.map((r) => r.visit.id));
  const live = (r) => [
    ...(r.visit.clientId === 'c-noid' ? ['client has no Medicaid ID on file'] : []),
    ...db.describeOverlapConflicts(conflicts[r.visit.id]),
  ];
  const state = (id) => { const r = rows.find((x) => x.visit.id === id); return exportState({ visit: r.visit, latestSync: r.latestSync, problems: live(r) }).key; };
  eq('accepted / rejected by the state / sent / blocked locally (overlap, missing Medicaid ID)',
    [state('s-ok'), state('s3-fail'), state('s-held'), state('s-ovA'), state('s-noid')],
    ['accepted', 'rejected', 'sent', 'blocked', 'blocked']);
  const noidRow = rows.find((x) => x.visit.id === 's-noid');
  check('  ...a locally blocked visit shows the live reason',
    /^client has no Medicaid ID/.test(exportState({ visit: noidRow.visit, latestSync: noidRow.latestSync, problems: live(noidRow) }).detail || ''));

  console.log('\n== fixing a blocked visit and sending it again ==');
  await db.updateClientEvvIdentity(ORG, 'c-noid', { medicaidId: '999000502' });
  eq('once the Medicaid ID is added, the visit is ready to queue again',
    exportState({ visit: noidRow.visit, latestSync: noidRow.latestSync, problems: [] }).key, 'not_queued');
  await db.queueVisitsForExport(ORG, ['s-noid'], actor);
  await processQueue(ORG, { limit: 50 });
  eq('  ...and re-queued it is sent', (await syncOf('s-noid')).status, 'sent');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`EVV SENDER RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  mock?.kill();
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); mock?.kill(); await pool.end(); process.exit(2); });
