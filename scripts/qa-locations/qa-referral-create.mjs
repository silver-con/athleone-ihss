// QA for the manual "New Referral" entry point (2026-09-21) — the fix for
// the biggest remaining product gap: a self-service agency had no way to
// get its first client into the system at all (fax/OCR intake is still
// deferred). Exercises the real createReferral() writer, then proves the
// resulting row is exactly what the existing submitIntake() path expects,
// so the two features are proven to actually connect end to end.
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
const OTHER = 'org-r2';

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Referral Agency','active'),($2,'Other Agency','active')`, [ORG, OTHER]);
  const loc = await db.createLocation(ORG, { name: 'Main', commissionRate: 0 });

  console.log('\n== createReferral validates every required field (same fields the fax path always supplied) ==');
  const full = {
    payer: 'Molina Healthcare', clientName: 'Test Client', dob: '01/01/1950',
    service: 'Personal Care Services', authHours: '15 hrs/wk', authNumber: 'MHC-1',
    diagnosis: 'Mobility impairment', receivedDate: '09/21/2026',
  };
  for (const key of Object.keys(full)) {
    const partial = { ...full, [key]: '' };
    await throws(`missing ${key} is rejected`, () => db.createReferral(ORG, partial), `${key} is required`);
  }
  eq('  ...and nothing was created by any of the rejected attempts', (await db.getReferrals(ORG)).length, 0);

  console.log('\n== a complete referral is created and tenant-scoped ==');
  const id = await db.createReferral(ORG, full);
  check('createReferral returns an id', typeof id === 'string' && id.length > 0);
  const stored = await db.getReferral(ORG, id);
  check('the org cannot see it under another tenant', (await db.getReferral(OTHER, id)) === null);
  eq('payer stored', stored.payer, 'Molina Healthcare');
  eq('clientName stored', stored.clientName, 'Test Client');
  eq('status defaults to new (same as the fax path)', stored.status, 'new');
  eq('it appears in the org\'s referral queue', (await db.getReferrals(ORG)).length, 1);

  console.log('\n== leading/trailing whitespace is trimmed, matching a human typing into the form ==');
  const messyId = await db.createReferral(ORG, { ...full, clientName: '  Messy Name  ', payer: '  Anthem  ' });
  const messy = await db.getReferral(ORG, messyId);
  eq('clientName trimmed', messy.clientName, 'Messy Name');
  eq('payer trimmed', messy.payer, 'Anthem');

  console.log('\n== the manually-created referral is a real front door: submitIntake accepts it exactly like a fax-sourced one ==');
  const client = await db.submitIntake(ORG, id, {
    clientName: stored.clientName, dob: stored.dob, phone: '5551234567',
    authHours: stored.authHours, careNeeds: [], locationId: loc,
  });
  check('intake completes and returns a client', typeof client.clientId === 'string' || typeof client.id === 'string' || typeof client.clientName === 'string');
  const completedReferral = await db.getReferral(ORG, id);
  eq('the referral is marked completed', completedReferral.status, 'completed');
  const clients = await db.getClients(ORG);
  eq('exactly one client now exists for this org', clients.length, 1);
  eq('the client carries the location picked at intake', clients[0].locationId, loc);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`REFERRAL-CREATE RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
