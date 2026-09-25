// QA for DocuSign Connect (automatic envelope status) and welcome invites
// (2026-09-25).
process.env.SESSION_SECRET ||= 'qa-session-secret-qa-session-secret';
for (const k of ['EMAIL_PROVIDER', 'SMS_PROVIDER', 'APP_BASE_URL']) delete process.env[k];

import bcrypt from 'bcryptjs';
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { connectSignature, isValidConnectSignature, parseConnectEvent, applyConnectEvent } from './docusign-connect.js';
import * as S from './sign-in.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
const logged = [];
const origLog = console.log;
console.log = (...a) => { const l = a.join(' '); if (l.startsWith('[comms]')) { logged.push(l); return; } origLog(...a); };

const ORG = 'org-ds';
const OTHER = 'org-ds-2';

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'DS Agency','active'), ($2,'DS Other','active')`, [ORG, OTHER]);
  const loc = await db.createLocation(ORG, { name: 'Main' });
  const loc2 = await db.createLocation(OTHER, { name: 'Main' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('ds-cg',$1,'Dana','Aide','5125550111','onboarding',$2), ('ds-cg2',$3,'Otto','Aide','5125550112','onboarding',$4)`, [ORG, loc, OTHER, loc2]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ('ds-c',$1,'Cora','Molina','10','09/01/2026',$2)`, [ORG, loc]);

  console.log('\n== HMAC signatures ==');
  const secret = 'connect-secret-0123456789';
  const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'env-1', envelopeSummary: { status: 'completed' } } });
  const sig = connectSignature(secret, body);
  check('a correct signature verifies', isValidConnectSignature(secret, body, [sig]));
  check('any of several signatures (key rotation) is accepted', isValidConnectSignature(secret, body, ['nope', sig]));
  check('the wrong secret is refused', !isValidConnectSignature('other-secret-0000000000', body, [sig]));
  check('a changed body is refused', !isValidConnectSignature(secret, body.replace('env-1', 'env-2'), [sig]));
  check('no signature is refused', !isValidConnectSignature(secret, body, []));
  check('no secret configured is refused', !isValidConnectSignature(null, body, [sig]));
  // Known-answer check computed independently with openssl:
  // printf '%s' '{"a":1}' | openssl dgst -sha256 -hmac 'k' -binary | base64
  eq('matches an independently computed HMAC-SHA256', connectSignature('k', '{"a":1}'), 'w6kv+eJ0zczieljBWnjsbcu9vQA4qH56EbrvICj9i/8=');

  console.log('\n== event parsing ==');
  eq('JSON SIM', parseConnectEvent(JSON.parse(body)), { envelopeId: 'env-1', status: 'completed', event: 'envelope-completed' });
  eq('legacy JSON', parseConnectEvent({ envelopeId: 'env-9', status: 'Completed' }), { envelopeId: 'env-9', status: 'completed', event: null });
  eq('status taken from the event name when the summary is missing', parseConnectEvent({ event: 'envelope-declined', data: { envelopeId: 'e' } }).status, 'declined');

  console.log('\n== applying events ==');
  await db.markPacketSent(ORG, 'ds-cg', 'env-1');
  await db.markPacketSent(OTHER, 'ds-cg2', 'env-1'); // same id in another agency must not be touched
  await query(`INSERT INTO caregiver_orientations (id, organization_id, caregiver_id, client_id, orientation_type, status, envelope_id) VALUES ('ds-o1',$1,'ds-cg','ds-c','initial','draft','env-2')`, [ORG]);
  let r = await applyConnectEvent(ORG, JSON.parse(body));
  eq('a completed packet envelope marks the packet signed', r.packets, 1);
  const docs = await query(`SELECT status FROM caregiver_documents WHERE organization_id = $1 AND caregiver_id = 'ds-cg'`, [ORG]);
  check('  ...every packet document is signed', docs.length === 3 && docs.every((d) => d.status === 'signed'));
  const otherDocs = await query(`SELECT status FROM caregiver_documents WHERE organization_id = $1`, [OTHER]);
  check('  ...another agency’s documents with the same envelope id are untouched', otherDocs.every((d) => d.status === 'sent'));
  r = await applyConnectEvent(ORG, { envelopeId: 'env-2', status: 'sent' });
  check('a non-completed status changes nothing', r.orientations === 0 && (await queryOne(`SELECT status FROM caregiver_orientations WHERE id = 'ds-o1'`)).status === 'draft');
  r = await applyConnectEvent(ORG, { event: 'envelope-completed', data: { envelopeId: 'env-2', envelopeSummary: { status: 'completed' } } });
  check('a completed orientation envelope completes the orientation', r.orientations === 1 && (await queryOne(`SELECT status FROM caregiver_orientations WHERE id = 'ds-o1'`)).status === 'completed');
  r = await applyConnectEvent(ORG, { envelopeId: 'env-unknown', status: 'completed' });
  check('an unknown envelope is harmless', r.packets === 0 && r.orientations === 0);

  console.log('\n== storing the Connect key ==');
  let threw = null;
  try { await db.setDocusignConnectKey(ORG, 'enc'); } catch (e) { threw = e.message; }
  check('needs the DocuSign connection saved first', /connection first/.test(threw || ''));
  await db.upsertDocusignCredentials(ORG, { integrationKey: 'ik', apiUsername: 'u', accountId: 'a', privateKeyEnc: 'x', environment: 'demo', status: 'connected' });
  await db.setDocusignConnectKey(ORG, 'encrypted-blob');
  let c = await db.getDocusignCredentials(ORG);
  check('saved and reported as configured', c.connectConfigured && c.connectHmacKeyEnc === 'encrypted-blob');
  await applyConnectEvent(ORG, { envelopeId: 'x', status: 'sent' });
  check('an event records when it arrived', Boolean((await db.getDocusignCredentials(ORG)).connectLastEventAt));
  await db.setDocusignConnectKey(ORG, null);
  check('can be removed', !(await db.getDocusignCredentials(ORG)).connectConfigured);

  console.log('\n== welcome invites ==');
  const uid = await db.createOrgUser(ORG, { name: 'Wendy Welcome', email: 'wendy@ds.test', role: 'COORDINATOR', passwordHash: await bcrypt.hash('Starting-Pass-1', 4) });
  const w = await S.sendWelcomeInvite('wendy@ds.test', { baseUrl: 'https://app.example.com', role: 'COORDINATOR' });
  eq('a welcome email is recorded', w.status, 'logged');
  const line = logged.at(-1);
  const fields = JSON.parse(line.slice(line.indexOf('{')));
  check('  ...it links to choosing a password', fields.template === 'welcome' && fields.text.includes('https://app.example.com/reset-password?token='));
  eq('  ...its body is not stored (the link is a secret)', (await queryOne(`SELECT body FROM notifications WHERE template = 'welcome'`)).body, null);
  const token = decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(fields.text)[1]);
  const t = await queryOne('SELECT expires_at FROM password_reset_tokens WHERE token_hash = $1', [S.hashResetToken(token)]);
  const days = (new Date(t.expires_at) - Date.now()) / 86400000;
  check('  ...the link lasts 7 days, not an hour', days > 6.9 && days <= 7.01);
  const done = await S.completePasswordReset(token, 'Blue-Lantern-Rain-9', 'Blue-Lantern-Rain-9');
  check('using it sets her password', done.ok);
  const u = await queryOne('SELECT must_change_password FROM users WHERE id = $1', [uid]);
  eq('  ...and she is not asked to change it again', u.must_change_password, false);
  eq('no base URL -> no invite (production without APP_BASE_URL)', await S.sendWelcomeInvite('wendy@ds.test', { baseUrl: null, role: 'COORDINATOR' }), null);
  eq('unknown email -> no invite', await S.sendWelcomeInvite('ghost@ds.test', { baseUrl: 'https://x', role: 'COORDINATOR' }), null);
}

run().then(async () => {
  console.log = origLog;
  console.log('\n' + '='.repeat(60));
  console.log(`DOCUSIGN/WELCOME RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.log = origLog; console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
