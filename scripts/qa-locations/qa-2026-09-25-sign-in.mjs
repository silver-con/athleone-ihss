// QA for "Forgot password?" and two-step sign-in (2026-09-25), through the
// real lib/sign-in.js + lib/queries.js against the scratch database. Email
// and SMS run in log mode (no provider configured), so codes and links are
// captured from the server-log line lib/comms prints.
process.env.SESSION_SECRET ||= 'qa-session-secret-qa-session-secret';
for (const k of ['EMAIL_PROVIDER', 'SMS_PROVIDER', 'APP_BASE_URL']) delete process.env[k];

import bcrypt from 'bcryptjs';
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import * as S from './sign-in.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

// Capture what lib/comms logs in log mode (it prints sensitive bodies only
// in log mode — exactly so this kind of local test is possible).
const logged = [];
const origLog = console.log;
console.log = (...args) => {
  const line = args.join(' ');
  if (line.startsWith('[comms] ')) { logged.push(line); return; }
  origLog(...args);
};
function lastLogged() {
  const line = logged[logged.length - 1] || '';
  return JSON.parse(line.slice(line.indexOf('{')));
}
const tokenFrom = (text) => decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(text)[1]);
const codeFrom = (fields) => /\b(\d{6})\b/.exec(fields.text || fields.body || fields.subject)[1];

const ORG = 'org-signin';
// requestPasswordReset answers at once and finishes in the background (so
// timing doesn't reveal which emails exist); tests wait for the work.
async function reset(email, opts) {
  const r = await S.requestPasswordReset(email, opts);
  await r.done;
  return r;
}
const subjectOf = async (id) => S.signInSubject(await db.loadSignInAccount('user', id));
const PW = 'Correct-Horse-9';

async function makeUser(email, role, extra = {}) {
  const id = await db.createOrgUser(ORG, { name: extra.name || 'Pat Person', email, role, passwordHash: await bcrypt.hash(PW, 4) });
  await query('UPDATE users SET must_change_password = false WHERE id = $1', [id]);
  return id;
}

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Sign-In Agency','active')`, [ORG]);
  const adminId = await makeUser('boss@signin.test', 'ADMIN', { name: 'Bo Boss' });
  const coordId = await makeUser('coord@signin.test', 'COORDINATOR', { name: 'Cy Coord' });
  await query(`INSERT INTO platform_admins (id,email,password_hash,name) VALUES ('pa-1','ops@hearth.test',$1,'Ops Person')`, [await bcrypt.hash(PW, 4)]);

  console.log('\n== forgot password: never reveals whether an account exists ==');
  const a = await reset('boss@signin.test', { baseUrl: 'https://app.example.com/' });
  const b = await reset('nobody@nowhere.test', { baseUrl: 'https://app.example.com' });
  eq('same message for a real and an unknown email', a.message, b.message);
  const emailed = lastLogged();
  check('a real account gets a reset email', emailed.template === 'password_reset' && emailed.to === 'boss@signin.test');
  const token = tokenFrom(emailed.text);
  check('  ...link points at the given base URL, no double slash', emailed.text.includes('https://app.example.com/reset-password?token='));
  check('  ...token is long and random (>= 40 chars)', token.length >= 40);
  const stored = await queryOne('SELECT * FROM password_reset_tokens WHERE account_id = $1', [adminId]);
  check('only the SHA-256 of the token is stored', stored.token_hash === S.hashResetToken(token) && !JSON.stringify(stored).includes(token));
  const outbox = await queryOne(`SELECT body FROM notifications WHERE template = 'password_reset' ORDER BY created_at DESC LIMIT 1`);
  eq('the outbox row has no body (the link is a secret)', outbox.body, null);
  const auditRow = await queryOne(`SELECT action FROM audit_log WHERE organization_id = $1 AND action = 'password_reset_requested'`, [ORG]);
  check('the request is in the audit log', Boolean(auditRow));

  console.log('\n== completing a reset ==');
  check('the fresh link is usable', await S.isResetTokenUsable(token));
  let r = await S.completePasswordReset(token, 'short', 'short');
  check('a too-short password is refused', !r.ok && /at least/.test(r.error));
  check('  ...without burning the link', await S.isResetTokenUsable(token));
  r = await S.completePasswordReset(token, 'Brand-New-Pass-77', 'Brand-New-Pass-78');
  check('mismatched confirmation refused', !r.ok && /match/.test(r.error));
  const svBefore = (await queryOne('SELECT session_version FROM users WHERE id = $1', [adminId])).session_version;
  await query(`INSERT INTO login_attempts (email, failed_count, locked_until) VALUES ('boss@signin.test', 5, now() + interval '10 minutes')`);
  r = await S.completePasswordReset(token, 'Brand-New-Pass-77', 'Brand-New-Pass-77');
  check('a good password completes the reset', r.ok);
  const after = await queryOne('SELECT * FROM users WHERE id = $1', [adminId]);
  check('  ...new password works', await bcrypt.compare('Brand-New-Pass-77', after.password_hash));
  check('  ...every existing session is signed out (session_version moved)', after.session_version === svBefore + 1);
  eq('  ...must_change_password is off (they chose it)', after.must_change_password, false);
  check('  ...the sign-in lockout was cleared', !(await db.getLoginLock('boss@signin.test')));
  check('  ...a "password changed" email went out', lastLogged().template === 'password_changed');
  check('the link cannot be used twice', !(await S.completePasswordReset(token, 'Another-Pass-88', 'Another-Pass-88')).ok);
  check('  ...and no longer shows as usable', !(await S.isResetTokenUsable(token)));
  const login = await db.authenticateLogin('boss@signin.test', 'Brand-New-Pass-77');
  check('sign-in works with the new password', login.ok);

  console.log('\n== reset links: expiry, replacement, rate limit ==');
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  const t1 = tokenFrom(lastLogged().text);
  await query(`UPDATE password_reset_tokens SET created_at = created_at - interval '2 minutes' WHERE account_id = $1`, [coordId]);
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  const t2 = tokenFrom(lastLogged().text);
  check('a newer request voids the older link', !(await S.isResetTokenUsable(t1)) && (await S.isResetTokenUsable(t2)));
  await query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [S.hashResetToken(t2)]);
  check('an expired link is refused', !(await S.completePasswordReset(t2, 'Fine-Password-11', 'Fine-Password-11')).ok);
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  const n = logged.length;
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  eq('a 4th request in an hour sends nothing', logged.length, n);
  check('  ...but answers the same way', (await reset('coord@signin.test', { baseUrl: 'https://x' })).ok);
  await query(`UPDATE users SET active = false WHERE id = $1`, [coordId]);
  await query(`DELETE FROM password_reset_tokens WHERE account_id = $1`, [coordId]);
  const before = logged.length;
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  eq('a deactivated account gets no email', logged.length, before);
  await query(`UPDATE users SET active = true WHERE id = $1`, [coordId]);
  check('a garbage token is not usable', !(await S.isResetTokenUsable('abc')) && !(await S.isResetTokenUsable('')));

  console.log('\n== platform admins can reset too ==');
  await reset('ops@hearth.test', { baseUrl: 'https://x' });
  const pt = tokenFrom(lastLogged().text);
  r = await S.completePasswordReset(pt, 'Platform-Pass-123', 'Platform-Pass-123');
  check('platform admin reset completes', r.ok);
  check('  ...and they can sign in', (await db.authenticateLogin('ops@hearth.test', 'Platform-Pass-123')).ok);

  console.log('\n== who gets a second step ==');
  let acct = await subjectOf(adminId);
  eq('off by default', S.twoFactorPlan(acct), null);
  await db.updateOrganizationRequireTwoFactor(ORG, true);
  acct = await subjectOf(adminId);
  eq('agency requirement -> office account gets email', S.twoFactorPlan(acct)?.channel, 'email');
  eq('  ...masked destination', S.twoFactorPlan(acct)?.masked, 'b•••@signin.test');
  const cgFake = { ...acct, role: 'CAREGIVER' };
  eq('agency requirement does not force caregivers', S.twoFactorPlan(cgFake), null);
  await db.updateTwoFactorSettings(ORG, adminId, { method: 'sms', mobilePhone: '+15125550147' });
  acct = await subjectOf(adminId);
  eq('chose text + has a number -> sms', [S.twoFactorPlan(acct).channel, S.twoFactorPlan(acct).masked], ['sms', '•••-•••-0147']);
  await db.updateTwoFactorSettings(ORG, adminId, { method: 'sms', mobilePhone: null });
  acct = await subjectOf(adminId);
  eq('chose text but no number -> falls back to email, never skips', S.twoFactorPlan(acct).channel, 'email');
  let threw = false;
  try { await db.updateTwoFactorSettings(ORG, adminId, { method: 'carrier-pigeon' }); } catch { threw = true; }
  check('an unknown method is refused', threw);
  await db.updateTwoFactorSettings(ORG, adminId, { method: 'email', mobilePhone: null });

  console.log('\n== codes ==');
  acct = await subjectOf(adminId);
  let st = await S.startSignInChallenge(acct, { nextPath: '/admin/evv' });
  check('a challenge starts and a code is emailed', st.ok && st.channel === 'email' && lastLogged().template === 'sign_in_code');
  let code = codeFrom(lastLogged());
  const ch = await db.getSignInChallenge(st.challengeId);
  check('the code itself is not stored', ch.codeHash !== code && !ch.codeHash.includes(code) && ch.codeHash.length === 64);
  eq('the sign-in-code outbox row has no body', (await queryOne(`SELECT body FROM notifications WHERE template = 'sign_in_code' ORDER BY created_at DESC LIMIT 1`)).body, null);
  const again = await S.startSignInChallenge(acct);
  check('asking again within 30 seconds is refused', !again.ok && /30 seconds/.test(again.error));
  let v = await S.verifySignInChallenge(st.challengeId, '000000' === code ? '111111' : '000000');
  check('a wrong code is refused with tries left', !v.ok && /4 tries left/.test(v.error) && !v.restart);
  v = await S.verifySignInChallenge(st.challengeId, code.slice(0, 3) + ' ' + code.slice(3));
  check('the right code (spaces ignored) signs in', v.ok && v.account.user.id === adminId);
  eq('  ...and remembers where they were going', v.nextPath, '/admin/evv');
  v = await S.verifySignInChallenge(st.challengeId, code);
  check('a used code cannot be replayed', !v.ok && v.restart);

  // five wrong guesses
  await query(`UPDATE sign_in_challenges SET created_at = created_at - interval '1 minute' WHERE account_id = $1`, [adminId]);
  st = await S.startSignInChallenge(acct);
  code = codeFrom(lastLogged());
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) v = await S.verifySignInChallenge(st.challengeId, wrong);
  check('after 5 wrong codes the sign-in ends', !v.ok && v.restart);
  v = await S.verifySignInChallenge(st.challengeId, code);
  check('  ...and even the right code no longer works', !v.ok && v.restart);

  await query(`UPDATE sign_in_challenges SET created_at = created_at - interval '1 minute' WHERE account_id = $1`, [adminId]);
  st = await S.startSignInChallenge(acct);
  code = codeFrom(lastLogged());
  await query(`UPDATE sign_in_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [st.challengeId]);
  v = await S.verifySignInChallenge(st.challengeId, code);
  check('an expired code is refused', !v.ok && /expired/.test(v.error));

  check('an unknown challenge id is refused', !(await S.verifySignInChallenge('nope', '123456')).ok);

  // deactivated between password and code
  await query(`UPDATE sign_in_challenges SET created_at = created_at - interval '1 minute' WHERE account_id = $1`, [adminId]);
  st = await S.startSignInChallenge(acct);
  code = codeFrom(lastLogged());
  await query(`UPDATE users SET active = false WHERE id = $1`, [adminId]);
  v = await S.verifySignInChallenge(st.challengeId, code);
  check('an account deactivated mid-sign-in cannot finish', !v.ok && /deactivated/.test(v.error));
  await query(`UPDATE users SET active = true WHERE id = $1`, [adminId]);

  // hourly cap
  for (let i = 0; i < 5; i++) {
    await query(`UPDATE sign_in_challenges SET created_at = now() - interval '1 minute' WHERE account_id = $1`, [adminId]);
    if ((await db.countRecentSignInChallenges('user', adminId, 15)).count >= 5) break;
    await S.startSignInChallenge(acct);
  }
  await query(`UPDATE sign_in_challenges SET created_at = now() - interval '1 minute' WHERE account_id = $1`, [adminId]);
  const count = (await db.countRecentSignInChallenges('user', adminId, 15)).count;
  check('five codes already requested in the window', count >= 5);
  st = await S.startSignInChallenge(acct);
  check('a sixth within 15 minutes is refused', !st.ok && /Too many codes/.test(st.error));

  console.log('\n== sms codes ==');
  await db.updateTwoFactorSettings(ORG, coordId, { method: 'sms', mobilePhone: '+15125550199' });
  const cacct = await subjectOf(coordId);
  st = await S.startSignInChallenge(cacct);
  const smsLine = lastLogged();
  check('an sms code goes to the E.164 number', st.ok && st.channel === 'sms' && smsLine.to === '+15125550199');
  v = await S.verifySignInChallenge(st.challengeId, codeFrom(smsLine));
  check('  ...and verifies', v.ok);

  console.log('\n== review fixes ==');
  const leaked = await queryOne(`SELECT count(*)::int AS n FROM notifications WHERE template = 'sign_in_code' AND (subject ~ '[0-9]{6}' OR body IS NOT NULL)`);
  eq('no sign-in code is stored anywhere in the outbox (subject or body)', leaked.n, 0);

  // a password change voids outstanding links and codes
  await query(`DELETE FROM password_reset_tokens`);
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  const pending = tokenFrom(lastLogged().text);
  await query(`UPDATE sign_in_challenges SET created_at = now() - interval '2 minutes' WHERE account_id = $1`, [coordId]);
  const pendingCode = await S.startSignInChallenge(cacct);
  await db.changeOwnPassword(ORG, coordId, PW, await bcrypt.hash('Changed-Myself-44', 4), 'Changed-Myself-44');
  check('changing your password voids an outstanding reset link', !(await S.isResetTokenUsable(pending)));
  check('  ...and any pending sign-in code', (await db.getSignInChallenge(pendingCode.challengeId)).consumedAt !== null);

  // daily cap on codes
  await query(`UPDATE sign_in_challenges SET created_at = now() - interval '2 hours' WHERE account_id = $1`, [adminId]);
  const total = (await db.countRecentSignInChallenges('user', adminId, 1440)).count;
  for (let i = total; i < S.CODE_MAX_PER_DAY; i++) {
    await query(`INSERT INTO sign_in_challenges (id, account_kind, account_id, code_hash, channel, destination, expires_at, created_at) VALUES ($1,'user',$2,'x','email','x', now(), now() - interval '3 hours')`, ['cap-' + i, adminId]);
  }
  const capped = await S.startSignInChallenge(acct);
  check(`after ${S.CODE_MAX_PER_DAY} codes in a day, no more are sent`, !capped.ok && /today/.test(capped.error));

  // production without a provider: nothing secret is created or logged
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  check('production + no email provider: codes/links are not deliverable', !S.canDeliver('email') && !S.canDeliver('sms'));
  eq('  ...two-step plan says so (sign-in proceeds without a code, audited)', S.twoFactorPlan(acct).deliverable, false);
  await query(`DELETE FROM password_reset_tokens`);
  const before2 = logged.length;
  await reset('coord@signin.test', { baseUrl: 'https://x' });
  eq('  ...forgot-password creates no link', (await queryOne('SELECT count(*)::int AS n FROM password_reset_tokens')).n, 0);
  check('  ...and logs no link', !logged.slice(before2).some((l) => l.includes('token=')));
  process.env.EMAIL_PROVIDER = 'sendgrid';
  process.env.SENDGRID_API_KEY = 'SG.x';
  process.env.EMAIL_FROM = 'H <h@x.test>';
  check('production + email connected: deliverable', S.canDeliver('email'));
  eq('platform admins get an email code whenever email is connected', S.twoFactorPlan({ kind: 'platform', id: 'pa-1', email: 'ops@hearth.test' })?.channel, 'email');
  for (const k of ['EMAIL_PROVIDER', 'SENDGRID_API_KEY', 'EMAIL_FROM']) delete process.env[k];
  process.env.NODE_ENV = prevEnv;
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  eq('platform admins: no email connected -> no code step', S.twoFactorPlan({ kind: 'platform', id: 'pa-1', email: 'ops@hearth.test' }), null);

  // platform admin reset signs out old sessions
  const svBeforePa = (await queryOne(`SELECT session_version FROM platform_admins WHERE id = 'pa-1'`)).session_version;
  const oldPayload = { userId: 'pa-1', role: 'PLATFORM_ADMIN', organizationId: null, sv: svBeforePa };
  check('a current platform session is valid', (await db.getSessionAccountState(oldPayload)) !== null);
  await reset('ops@hearth.test', { baseUrl: 'https://x' });
  const pt2 = tokenFrom(lastLogged().text);
  check('platform reset completes', (await S.completePasswordReset(pt2, 'Platform-Again-321', 'Platform-Again-321')).ok);
  eq('  ...and the old platform session is signed out', await db.getSessionAccountState(oldPayload), null);
}

run().then(async () => {
  console.log = origLog;
  console.log('\n' + '='.repeat(60));
  console.log(`SIGN-IN RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.log = origLog; console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
