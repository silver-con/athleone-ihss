// QA for the 2026-09-23 access-control pass: sign-in (generic errors,
// lockout, deactivated / suspended / inactive-caregiver refusal), the
// per-request session re-check, office-account lifecycle (deactivate,
// role/location change, password reset) with its safety rails, caregiver
// login reset, self-service password change, and the password policy.
import bcrypt from 'bcryptjs';
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { passwordProblem, generateTemporaryPassword } from './passwords.js';

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
const hash = (pw) => bcrypt.hash(pw, 4);
const payloadFor = (u, sv) => ({ userId: u.id, organizationId: u.organizationId, role: u.role, sv });

const A = 'org-ac';
const B = 'org-ac2';
const PW = 'correct horse battery';
const GENERIC = 'Email or password is incorrect.';

async function run() {
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM platform_admins WHERE email LIKE $1', ['%@ac.test']);

  console.log('\n== password policy ==');
  check('9 characters is too short', passwordProblem('abcdefghi') !== null);
  check('a 4-word phrase is fine', passwordProblem('blue kettle river song') === null);
  check('a common password is refused', passwordProblem('password123') !== null);
  check('a repeated character is refused', passwordProblem('aaaaaaaaaaaa') !== null);
  check('containing the email name is refused', passwordProblem('mariagonzalez99', { email: 'mariagonzalez@x.test' }) !== null);
  check('over 128 characters is refused', passwordProblem('x'.repeat(129) + 'y') !== null);
  const temp = generateTemporaryPassword();
  check('a generated temporary password passes the policy', passwordProblem(temp) === null, temp);
  check('  ...and has no look-alike characters', !/[0O1lI]/.test(temp), temp);
  check('two generated passwords differ', temp !== generateTemporaryPassword());

  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Access Agency','active'),($2,'Other Agency','active')`, [A, B]);
  const loc = await db.createLocation(A, { name: 'North' });
  const adminId = await db.createOrgUser(A, { name: 'Ada Admin', email: 'ada@ac.test', role: 'ADMIN', passwordHash: await hash(PW) });
  const coordId = await db.createOrgUser(A, { name: 'Cole Coord', email: 'cole@ac.test', role: 'COORDINATOR', passwordHash: await hash(PW) });
  const otherOrgUserId = await db.createOrgUser(B, { name: 'Bea Other', email: 'bea@ac.test', role: 'ADMIN', passwordHash: await hash(PW) });

  console.log('\n== new accounts must set their own password ==');
  const cole = await db.getOrgUser(A, coordId);
  eq('a newly created office account has mustChangePassword', cole.mustChangePassword, true);
  eq('  ...is active', cole.active, true);

  console.log('\n== sign-in errors never reveal whether an email exists ==');
  eq('wrong password -> generic error', (await db.authenticateLogin('cole@ac.test', 'nope nope nope')).error, GENERIC);
  eq('unknown email -> the SAME generic error', (await db.authenticateLogin('nobody@ac.test', 'nope nope nope')).error, GENERIC);
  await db.clearLoginFailures('cole@ac.test');
  await db.clearLoginFailures('nobody@ac.test');
  const ok = await db.authenticateLogin('  COLE@ac.test ', PW);
  eq('correct password (email trimmed, any case) signs in', ok.ok, true);
  eq('  ...as the tenant user', ok.kind, 'user');
  eq('  ...carrying session version 1', ok.user.sessionVersion, 1);
  eq('  ...and the must-change flag', ok.user.mustChangePassword, true);
  check('  ...and last sign-in is recorded', (await db.getOrgUser(A, coordId)).lastLoginAt !== null);

  console.log('\n== lockout after repeated failures ==');
  for (let i = 1; i <= 4; i++) await db.authenticateLogin('cole@ac.test', 'wrong guess ' + i);
  const fifth = await db.authenticateLogin('cole@ac.test', 'wrong guess 5');
  check('the 5th failure locks the account', /Too many failed/.test(fifth.error || ''), fifth.error);
  const whileLocked = await db.authenticateLogin('cole@ac.test', PW);
  eq('even the CORRECT password is refused while locked', whileLocked.ok, false);
  check('  ...with the lockout message', /Too many failed/.test(whileLocked.error || ''));
  const audit = await db.getAuditLog(A);
  check('the lockout is written to the audit log', audit.some((r) => r.action === 'account_locked' && r.entityId === coordId));
  for (let i = 1; i <= 5; i++) await db.authenticateLogin('ghost@ac.test', 'wrong guess ' + i);
  check('an email with NO account locks the same way (lockout does not reveal which emails exist)',
    /Too many failed/.test((await db.authenticateLogin('ghost@ac.test', 'x x x x x x x')).error || ''));
  const later = new Date(Date.now() + 16 * 60 * 1000);
  eq('after the lock expires the correct password works again', (await db.authenticateLogin('cole@ac.test', PW, later)).ok, true);
  eq('  ...and the failure count was cleared by that success', await db.getLoginLock('cole@ac.test', later), null);

  console.log('\n== the per-request session check ==');
  const colePayload = payloadFor({ id: coordId, organizationId: A, role: 'COORDINATOR' }, 1);
  const state = await db.getSessionAccountState(colePayload);
  eq('a current session is honoured', state?.role, 'COORDINATOR');
  eq('a session with an old version is refused', await db.getSessionAccountState({ ...colePayload, sv: 0 }), null);
  eq('a token without a version (issued before this change) is refused', await db.getSessionAccountState({ ...colePayload, sv: undefined }), null);
  eq('a session claiming a different organization is refused', await db.getSessionAccountState({ ...colePayload, organizationId: B }), null);
  eq('a session for a user id that does not exist is refused', await db.getSessionAccountState({ ...colePayload, userId: 'nope' }), null);

  console.log('\n== deactivate / reactivate ==');
  await throws('an admin cannot deactivate themself', () => db.setOrgUserActive(A, adminId, adminId, false), "can't change your own");
  await throws('the last active organization admin cannot be deactivated (by anyone)', () => db.setOrgUserActive(A, coordId, adminId, false), 'last active organization admin');
  eq('deactivating a coordinator reports a change', await db.setOrgUserActive(A, adminId, coordId, false), true);
  eq('  ...their existing session stops working immediately', await db.getSessionAccountState(colePayload), null);
  const deact = await db.authenticateLogin('cole@ac.test', PW);
  check('  ...and sign-in says the account is deactivated', /deactivated/.test(deact.error || ''), deact.error);
  eq('a wrong password for a deactivated account still gets only the generic error', (await db.authenticateLogin('cole@ac.test', 'bad bad bad bad')).error, GENERIC);
  await db.clearLoginFailures('cole@ac.test');
  check('deactivated_at is recorded', (await db.getOrgUser(A, coordId)).deactivatedAt !== null);
  eq('deactivating again is a no-op', await db.setOrgUserActive(A, adminId, coordId, false), false);
  await db.setOrgUserActive(A, adminId, coordId, true);
  eq('reactivated: they can sign in again', (await db.authenticateLogin('cole@ac.test', PW)).ok, true);
  eq('  ...but the session from BEFORE deactivation stays dead', await db.getSessionAccountState(colePayload), null);
  await throws('another agency cannot deactivate this account', () => db.setOrgUserActive(B, otherOrgUserId, coordId, false), 'not found');

  console.log('\n== role / location changes ==');
  const coleV = (await queryOne('SELECT session_version FROM users WHERE id = $1', [coordId])).session_version;
  await throws('location admin without a location is refused', () => db.updateOrgUserAccess(A, adminId, coordId, { role: 'LOCATION_ADMIN', locationId: null }), 'must be assigned');
  await throws("another agency's location is refused", () => db.createLocation(B, { name: 'Foreign' }).then((f) => db.updateOrgUserAccess(A, adminId, coordId, { role: 'LOCATION_ADMIN', locationId: f })), 'Location not found');
  eq('coordinator -> location admin of North', await db.updateOrgUserAccess(A, adminId, coordId, { role: 'LOCATION_ADMIN', locationId: loc }), true);
  const coleNow = await db.getOrgUser(A, coordId);
  eq('  ...role saved', coleNow.role, 'LOCATION_ADMIN');
  eq('  ...location saved', coleNow.locationId, loc);
  eq('  ...their old session is signed out', await db.getSessionAccountState({ ...colePayload, sv: coleV }), null);
  eq('  ...a new session sees the new role from the database', (await db.getSessionAccountState({ ...colePayload, sv: coleV + 1 }))?.role, 'LOCATION_ADMIN');
  await throws('the last admin cannot be demoted', () => db.updateOrgUserAccess(A, coordId, adminId, { role: 'COORDINATOR', locationId: null }), 'last active organization admin');
  await throws('an admin cannot change their own role', () => db.updateOrgUserAccess(A, adminId, adminId, { role: 'COORDINATOR' }), "can't change your own");
  const admin2Id = await db.createOrgUser(A, { name: 'Abe Admin', email: 'abe@ac.test', role: 'ADMIN', passwordHash: await hash(PW) });
  eq('with a second admin, the first CAN be demoted', await db.updateOrgUserAccess(A, admin2Id, adminId, { role: 'COORDINATOR', locationId: null }), true);
  await db.updateOrgUserAccess(A, admin2Id, adminId, { role: 'ADMIN', locationId: null });

  console.log('\n== admin password reset ==');
  const tempPw = generateTemporaryPassword();
  const coleV2 = (await queryOne('SELECT session_version FROM users WHERE id = $1', [coordId])).session_version;
  for (let i = 1; i <= 5; i++) await db.authenticateLogin('cole@ac.test', 'wrong guess ' + i);
  await db.resetOrgUserPassword(A, adminId, coordId, await hash(tempPw));
  eq('the reset also clears a lockout', await db.getLoginLock('cole@ac.test'), null);
  eq('the old password no longer works', (await db.authenticateLogin('cole@ac.test', PW)).ok, false);
  await db.clearLoginFailures('cole@ac.test');
  const afterReset = await db.authenticateLogin('cole@ac.test', tempPw);
  eq('the temporary password works', afterReset.ok, true);
  eq('  ...and forces a password change', afterReset.user.mustChangePassword, true);
  eq('  ...and every earlier session was signed out', await db.getSessionAccountState({ ...colePayload, sv: coleV2 }), null);
  await throws('an admin cannot reset their own password this way', () => db.resetOrgUserPassword(A, adminId, adminId, 'x'), "can't change your own");

  console.log('\n== changing your own password ==');
  await throws('the wrong current password is refused', () => db.changeOwnPassword(A, coordId, 'not it at all', 'h', 'new phrase for cole'), 'current password is incorrect');
  await throws('reusing the current password is refused', () => db.changeOwnPassword(A, coordId, tempPw, 'h', tempPw), 'different from your current');
  const newSv = await db.changeOwnPassword(A, coordId, tempPw, await hash('new phrase for cole'), 'new phrase for cole');
  eq('returns the bumped session version', newSv, afterReset.user.sessionVersion + 1);
  eq('must-change is cleared', (await db.getOrgUser(A, coordId)).mustChangePassword, false);
  eq('the new password signs in', (await db.authenticateLogin('cole@ac.test', 'new phrase for cole')).ok, true);

  console.log('\n== caregiver logins follow caregiver status ==');
  const cgId = await db.createCaregiverWithLogin(A, { name: 'Cara Giver', email: 'cara@ac.test', role: 'Home Care Aide', phone: '5550000000', passwordHash: await hash(PW), locationId: loc });
  await query(`UPDATE caregivers SET status = 'active' WHERE id = $1`, [cgId]);
  const cara = await db.authenticateLogin('cara@ac.test', PW);
  eq('an active caregiver signs in', cara.ok, true);
  eq('  ...and a new caregiver login must also set its own password', cara.user.mustChangePassword, true);
  const caraPayload = payloadFor({ id: cara.user.id, organizationId: A, role: 'CAREGIVER' }, cara.user.sessionVersion);
  check('  ...with a live session', (await db.getSessionAccountState(caraPayload)) !== null);
  await throws("a caregiver login can't be deactivated from the Team page", () => db.setOrgUserActive(A, adminId, cara.user.id, false), "follow the caregiver's status");
  await query(`UPDATE caregivers SET status = 'on-leave' WHERE id = $1`, [cgId]);
  check('an on-leave caregiver can still sign in (messages, onboarding)', (await db.authenticateLogin('cara@ac.test', PW)).ok);
  await query(`UPDATE caregivers SET status = 'inactive' WHERE id = $1`, [cgId]);
  eq('an INACTIVE caregiver\'s session stops working immediately', await db.getSessionAccountState(caraPayload), null);
  check('  ...and they cannot sign in', /deactivated/.test((await db.authenticateLogin('cara@ac.test', PW)).error || ''));
  await query(`UPDATE caregivers SET status = 'active' WHERE id = $1`, [cgId]);
  const otherLoc = await db.createLocation(A, { name: 'South' });
  await throws("a location admin from another location can't reset this caregiver", () => db.resetCaregiverLoginPassword(A, cgId, 'h', otherLoc), 'not found');
  const cgReset = await db.resetCaregiverLoginPassword(A, cgId, await hash(tempPw), loc);
  eq('a location admin in the right location can', cgReset.email, 'cara@ac.test');
  eq('  ...and the temporary password signs in', (await db.authenticateLogin('cara@ac.test', tempPw)).ok, true);

  console.log('\n== a suspended agency ==');
  const adaLogin = await db.authenticateLogin('ada@ac.test', PW);
  const adaPayload = payloadFor({ id: adminId, organizationId: A, role: 'ADMIN' }, adaLogin.user.sessionVersion);
  await query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [A]);
  eq("every session in a suspended agency stops working", await db.getSessionAccountState(adaPayload), null);
  check('  ...and sign-in explains the agency is suspended', /suspended/.test((await db.authenticateLogin('ada@ac.test', PW)).error || ''));
  eq('another agency is unaffected', (await db.authenticateLogin('bea@ac.test', PW)).ok, true);
  await query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [A]);

  console.log('\n== platform admins ==');
  const pa = await db.createPlatformAdmin({ name: 'Pat Platform', email: 'pat@ac.test', passwordHash: await hash(PW), platformRole: 'full' });
  const paLogin = await db.authenticateLogin('pat@ac.test', PW);
  eq('a platform admin signs in through the same form', paLogin.kind, 'platform');
  const paPayload = { userId: pa.id, role: 'PLATFORM_ADMIN', organizationId: null };
  check('  ...with a live session', (await db.getSessionAccountState(paPayload)) !== null);
  await query('UPDATE platform_admins SET active = false WHERE id = $1', [pa.id]);
  eq('a deactivated platform admin\'s session stops working', await db.getSessionAccountState(paPayload), null);
  eq('a wrong platform-admin password gets the generic error', (await db.authenticateLogin('pat@ac.test', 'bad bad bad bad')).error, GENERIC);
  await query('DELETE FROM platform_admins WHERE id = $1', [pa.id]);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`ACCESS CONTROL RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await query('DELETE FROM login_attempts');
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
