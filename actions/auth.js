'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { authenticateLogin, loadSignInAccount, getSignInChallenge, consumeSignInChallenge, logAuditEvent } from '@/lib/queries';
import { setSessionCookie, clearSessionCookie, getSession } from '@/lib/auth';
import { PERMISSIONS, ROLE_HOME, CHANGE_PASSWORD_PATH } from '@/lib/permissions';
import { createChallengeToken, verifyChallengeToken, CHALLENGE_COOKIE_NAME, CHALLENGE_MAX_AGE_SECONDS, cookieSecure } from '@/lib/session';
import { twoFactorPlan, startSignInChallenge, verifySignInChallenge, signInSubject } from '@/lib/sign-in';

// Only same-site relative paths. `//evil.example` and `/\\evil.example`
// both start with "/" but browsers treat them as another host — an open
// redirect that could send someone from a real Hearth login page to a
// look-alike site. (Fixed 2026-09-23; the old check was startsWith('/').)
function safeNext(next) {
  const n = String(next || '');
  if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\')) return '';
  return n;
}

// Sign-in for every role (tenant staff, caregivers and platform admins —
// see db/schema.sql's platform_admins comment for why it's one form). The
// checks themselves (lockout, generic error, deactivated/suspended) live in
// lib/queries.js authenticateLogin so QA can exercise them directly.
export async function loginAction(prevState, formData) {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const next = safeNext(formData.get('next'));

  const result = await authenticateLogin(email, password);
  if (!result.ok) return { error: result.error };

  // Two-step sign-in (2026-09-25): the password was right; if this account
  // needs a code, send one and park the browser on /login/verify holding
  // only a short-lived challenge cookie — no session yet.
  const account = result.kind === 'user' ? await loadSignInAccount('user', result.user.id) : result;
  if (!account.ok) return { error: account.error };
  const subject = signInSubject(account);
  const plan = twoFactorPlan(subject);
  if (plan && plan.deliverable) {
    const started = await startSignInChallenge(subject, { nextPath: next });
    if (!started.ok) return { error: started.error };
    await setChallengeCookie(started.challengeId);
    redirect('/login/verify');
  }
  if (plan && !plan.deliverable) {
    // Two-step is on for this account but its email/SMS provider isn't
    // connected on this (production) server — e.g. the keys were removed
    // after the fact. Enabling it is blocked in that state, so this only
    // happens by misconfiguration. Signing in without the code (and
    // recording that it happened) beats locking the whole office out of
    // an EVV system; the startup log warns loudly about the missing provider.
    console.warn(`[sign-in] two-step code skipped for ${subject.kind} ${subject.id}: ${plan.channel} not connected`);
    if (subject.kind === 'user') {
      await logAuditEvent(subject.organizationId, {
        actorUserId: subject.id,
        actorName: subject.name,
        actorRole: subject.role,
        locationId: subject.locationId || null,
        action: 'two_factor_skipped',
        entityType: 'user',
        entityId: subject.id,
        detail: `${plan.channel} is not connected on the server, so no sign-in code could be sent`,
      });
    }
  }

  await startSession(result);
  redirect(landingFor(result, next));
}

// Session cookie contents for a successful sign-in — shared by the
// password-only path above and the two-step path in verifyCodeAction.
async function startSession(result) {
  if (result.kind === 'platform') {
    const admin = result.admin;
    await setSessionCookie({
      userId: admin.id,
      organizationId: null,
      email: admin.email,
      name: admin.name,
      role: 'PLATFORM_ADMIN',
      // Sub-role WITHIN the platform-admin role — 'support' or 'full', see
      // db/schema.sql's comment on platform_admins.platform_role.
      platformRole: admin.platformRole,
      caregiverId: null,
      // Session version: a password reset moves it on and signs this out.
      sv: admin.sessionVersion,
    });
    return;
  }
  const user = result.user;
  await setSessionCookie({
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    caregiverId: user.caregiverId,
    // Location scope — null means agency-wide. Re-read from the database
    // on every request by getSession, like role.
    locationId: user.locationId,
    // Session version: getSession refuses the token once the account's
    // session_version moves on (deactivation, access change, password reset).
    sv: user.sessionVersion,
    // Read by proxy.js to route a first-time / just-reset account to the
    // change-password page before anything else.
    mustChangePassword: user.mustChangePassword,
  });
}

function landingFor(result, next) {
  if (result.kind === 'platform') return next || ROLE_HOME.PLATFORM_ADMIN;
  if (result.user.mustChangePassword) return CHANGE_PASSWORD_PATH;
  return next || ROLE_HOME[result.user.role] || '/';
}

async function setChallengeCookie(challengeId) {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE_NAME, await createChallengeToken(challengeId), {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
  });
}

async function readChallengeId() {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE_NAME)?.value;
  return token ? verifyChallengeToken(token) : null;
}

async function clearChallengeCookie() {
  (await cookies()).delete(CHALLENGE_COOKIE_NAME);
}

// /login/verify — the code from the email or text.
export async function verifyCodeAction(prevState, formData) {
  const challengeId = await readChallengeId();
  if (!challengeId) return { error: 'That sign-in has ended. Sign in again.', restart: true };
  const r = await verifySignInChallenge(challengeId, formData.get('code'));
  if (!r.ok) {
    if (r.restart) await clearChallengeCookie();
    return { error: r.error, restart: Boolean(r.restart) };
  }
  await clearChallengeCookie();
  await startSession(r.account);
  redirect(landingFor(r.account, safeNext(r.nextPath)));
}

// "Send a new code" — replaces the pending challenge with a fresh one.
export async function resendCodeAction() {
  const challengeId = await readChallengeId();
  const challenge = challengeId ? await getSignInChallenge(challengeId) : null;
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt) <= new Date()) {
    await clearChallengeCookie();
    return { error: 'That sign-in has ended. Sign in again.', restart: true };
  }
  const account = await loadSignInAccount(challenge.kind, challenge.accountId);
  if (!account.ok) {
    await clearChallengeCookie();
    return { error: account.error, restart: true };
  }
  const started = await startSignInChallenge(signInSubject(account), { nextPath: challenge.nextPath });
  if (!started.ok) return { error: started.error };
  await consumeSignInChallenge(challenge.id);
  await setChallengeCookie(started.challengeId);
  return { info: `A new code is on its way to ${started.masked}.` };
}

export async function cancelSignInAction() {
  await clearChallengeCookie();
  redirect('/login');
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/login');
}

export async function requireSession(allowedRoles) {
  const session = await getSession();
  if (!session || (allowedRoles && !allowedRoles.includes(session.role))) {
    redirect('/login');
  }
  // An account still on a starting/reset password can do nothing else
  // until it sets its own. proxy.js enforces this for page loads; this
  // covers Server Actions, which are public endpoints in their own right.
  if (session.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  return session;
}

// Every Server Action should call this instead of requireSession() directly
// — it looks the caller's specific function up in the lib/permissions.js
// catalog and enforces whatever role list is on file there, so the roles
// allowed to do a given thing live in exactly one place (the catalog) and
// not scattered across requireSession(['ROLE', ...]) calls throughout
// actions/*.js. requireSession itself is unchanged and still what actually
// checks the session — this is a thin, behavior-preserving lookup on top.
export async function requirePermission(permissionKey) {
  const entry = PERMISSIONS[permissionKey];
  if (!entry) {
    // Fail closed on a typo'd or removed key rather than silently letting
    // everyone (or no one) through.
    throw new Error(`requirePermission: unknown permission key "${permissionKey}"`);
  }
  return requireSession(entry.roles);
}
