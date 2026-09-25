// Password reset and two-step sign-in — the rules. Storage is in
// lib/queries.js, delivery in lib/comms. Server-side only; kept free of
// next/* imports so QA can drive it directly.
//
// PASSWORD RESET ("Forgot password?")
//   - The response never says whether an email has an account.
//   - The link carries a 256-bit random token; only its SHA-256 is stored.
//   - 60 minutes, single use, a new request voids the old link, at most
//     3 requests per account per hour (quietly ignored beyond that).
//   - Success signs the account out everywhere, clears any sign-in lockout,
//     and emails a "your password was changed" notice.
//
// TWO-STEP SIGN-IN
//   - Applies to agency accounts. The person picks email or text on
//     /account/security; an agency can require it for office staff on
//     /admin/settings (email, unless they picked text).
//   - 6-digit code, HMAC-hashed at rest, 10 minutes, 5 guesses, single use.
//   - At most 5 codes per 15 minutes per account and one every 30 seconds.
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as db from '@/lib/queries';
import { sendEmail, sendSms } from '@/lib/comms';
import { passwordResetEmail, passwordChangedEmail, signInCodeEmail, signInCodeSms, welcomeEmail } from '@/lib/comms/templates';
import { maskEmail, maskPhone, toE164 } from '@/lib/comms/phone';
import { emailConfig, smsConfig } from '@/lib/comms/config';
import { passwordProblem } from '@/lib/passwords';

export const RESET_MINUTES = 60;
export const INVITE_DAYS = 7;
export const RESET_MAX_PER_HOUR = 3;
export const CODE_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_MAX_PER_WINDOW = 5;
export const CODE_WINDOW_MINUTES = 15;
export const CODE_RESEND_SECONDS = 30;
export const CODE_MAX_PER_DAY = 10;

export const RESET_REQUESTED_MESSAGE =
  "If that email belongs to a Hearth account, we've sent it a link to choose a new password. It works for 60 minutes. Check your spam folder if it doesn't arrive.";
const BAD_LINK = 'This reset link is invalid, already used, or expired. Request a new one.';

const OFFICE_ROLES = new Set(['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR']);

export function hashResetToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function codeSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set.');
  return s;
}

export function hashSignInCode(challengeId, code) {
  return createHmac('sha256', codeSecret()).update(`${challengeId}:${code}`).digest('hex');
}

function sameHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

// Always resolves to { ok: true, message } — the same answer for a real
// account, an unknown email, a deactivated account, or a rate-limited one.
// `baseUrl` is where the link points (APP_BASE_URL, else the request host).
//
// The real work (token, email, audit row) runs in the background and the
// answer comes back straight away, so response time doesn't reveal which
// emails have accounts. `done` settles when that work finishes (tests wait
// on it; the page doesn't).
export async function requestPasswordReset(email, { baseUrl }) {
  const account = await db.findAccountForPasswordReset(email);
  const done = account ? sendResetLink(account, baseUrl).catch((err) => console.error('[password-reset] failed:', err.message)) : Promise.resolve();
  return { ok: true, message: RESET_REQUESTED_MESSAGE, done };
}

async function sendResetLink(account, baseUrl) {
  if ((await db.countRecentPasswordResets(account.kind, account.id, 60)) >= RESET_MAX_PER_HOUR) return;
  if (!canDeliver('email')) {
    // Production with no email provider: a link nobody can receive would
    // only be a liability, so none is made.
    console.warn('[password-reset] email is not connected; no reset link created');
    return;
  }
  const token = randomBytes(32).toString('base64url');
  await db.createPasswordResetToken({
    kind: account.kind,
    accountId: account.id,
    organizationId: account.organizationId,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });
  const resetUrl = `${String(baseUrl || '').replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    organizationId: account.organizationId,
    userId: account.kind === 'user' ? account.id : null,
    to: account.email,
    template: 'password_reset',
    fromName: account.organizationName ? `${account.organizationName} via Hearth` : undefined,
    ...passwordResetEmail({ name: account.name, organizationName: account.organizationName, resetUrl, minutes: RESET_MINUTES }),
  });
  if (account.organizationId) {
    await db.logAuditEvent(account.organizationId, {
      actorUserId: account.id,
      actorName: account.name,
      actorRole: 'SELF',
      action: 'password_reset_requested',
      entityType: 'user',
      entityId: account.id,
      detail: 'reset link emailed',
    });
  }
}

// Can a link or code actually reach someone on this channel? In
// development, yes even without a provider (it's printed to the terminal).
// In production only when the provider is connected.
export function canDeliver(channel) {
  if (process.env.NODE_ENV !== 'production') return true;
  return channel === 'sms' ? smsConfig().live : emailConfig().live;
}

export async function isResetTokenUsable(token) {
  if (!token || String(token).length < 20) return false;
  return Boolean(await db.peekPasswordResetToken(hashResetToken(token)));
}

// { ok: true, email } or { ok: false, error }. The password rules are
// checked BEFORE the token is consumed, so a too-short password doesn't
// burn the link.
export async function completePasswordReset(token, newPassword, confirmPassword) {
  if (!token) return { ok: false, error: BAD_LINK };
  if (newPassword !== confirmPassword) return { ok: false, error: "The passwords don't match." };
  const tokenHash = hashResetToken(token);
  const peek = await db.peekPasswordResetToken(tokenHash);
  if (!peek) return { ok: false, error: BAD_LINK };

  const account =
    peek.kind === 'user' ? await db.loadSignInAccount('user', peek.accountId) : await db.loadSignInAccount('platform', peek.accountId);
  const who = account.ok ? account.user || account.admin : null;
  const problem = passwordProblem(newPassword, { email: who?.email, name: who?.name });
  if (problem) return { ok: false, error: problem };
  if (!account.ok) return { ok: false, error: account.error };

  const claimed = await db.consumePasswordResetToken(tokenHash);
  if (!claimed) return { ok: false, error: BAD_LINK };

  const hash = await bcrypt.hash(String(newPassword), 10);
  await db.setPasswordFromReset(claimed.kind, claimed.accountId, claimed.organizationId, hash);
  await db.clearLoginFailures(who.email);

  if (claimed.organizationId) {
    await db.logAuditEvent(claimed.organizationId, {
      actorUserId: claimed.accountId,
      actorName: who.name,
      actorRole: who.role || 'SELF',
      locationId: who.locationId || null,
      action: 'password_reset_completed',
      entityType: 'user',
      entityId: claimed.accountId,
      detail: 'new password chosen through an emailed reset link; all sessions signed out',
    });
  }
  await sendEmail({
    organizationId: claimed.organizationId,
    userId: claimed.kind === 'user' ? claimed.accountId : null,
    to: who.email,
    template: 'password_changed',
    ...passwordChangedEmail({ name: who.name, organizationName: who.organizationName }),
  });
  return { ok: true, email: who.email };
}

// ---------------------------------------------------------------------------
// Two-step sign-in
// ---------------------------------------------------------------------------

// The person signing in, in one shape for both agency users and platform
// admins, from a loadSignInAccount() / authenticateLogin() result.
export function signInSubject(result) {
  if (!result?.ok) return null;
  if (result.kind === 'platform') {
    const a = result.admin;
    return { kind: 'platform', id: a.id, organizationId: null, name: a.name, email: a.email, role: 'PLATFORM_ADMIN' };
  }
  return { kind: 'user', ...result.user };
}

// Where this account's code should go, or null for no second step.
// { channel, to, masked, deliverable } — deliverable:false means the
// channel isn't connected on a production server (see loginAction).
export function twoFactorPlan(subject) {
  if (!subject) return null;
  if (subject.kind === 'platform') {
    // Platform admins can see every agency: whenever email is connected
    // they always get a code, no opt-in.
    if (!emailConfig().live) return null;
    return { channel: 'email', to: subject.email, masked: maskEmail(subject.email), deliverable: true };
  }
  let method = subject.twoFactorMethod || 'off';
  if (method === 'off' && subject.organizationRequiresTwoFactor && OFFICE_ROLES.has(subject.role)) method = 'email';
  if (method === 'off') return null;
  if (method === 'sms') {
    const phone = toE164(subject.mobilePhone);
    // Chose text but no usable number on file: fall back to email rather
    // than locking them out or silently skipping the second step.
    if (phone) return { channel: 'sms', to: phone, masked: maskPhone(phone), deliverable: canDeliver('sms') };
  }
  return { channel: 'email', to: subject.email, masked: maskEmail(subject.email), deliverable: canDeliver('email') };
}

// Creates and sends a code. Returns { ok, challengeId, channel, masked,
// delivered } or { ok: false, error } when rate-limited.
export async function startSignInChallenge(subject, { nextPath } = {}) {
  const plan = twoFactorPlan(subject);
  if (!plan) return { ok: false, error: 'Two-step sign-in is not on for this account.' };

  const recent = await db.countRecentSignInChallenges(subject.kind, subject.id, CODE_WINDOW_MINUTES);
  if (recent.count >= CODE_MAX_PER_WINDOW) {
    return { ok: false, error: `Too many codes requested. Wait ${CODE_WINDOW_MINUTES} minutes and sign in again.` };
  }
  if (recent.latest && Date.now() - new Date(recent.latest).getTime() < CODE_RESEND_SECONDS * 1000) {
    return { ok: false, error: `A code was just sent. Wait ${CODE_RESEND_SECONDS} seconds before asking for another.` };
  }
  // A daily cap as well: someone who knows the password can otherwise keep
  // signing in for fresh codes (and fresh guesses) indefinitely.
  const today = await db.countRecentSignInChallenges(subject.kind, subject.id, 24 * 60);
  if (today.count >= CODE_MAX_PER_DAY) {
    return { ok: false, error: 'Too many sign-in codes today. Try again tomorrow, or ask your administrator to reset your password.' };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // The code's hash is keyed on the challenge id, so the id is made here.
  const challengeId = randomUUID();
  await db.createSignInChallenge({
    id: challengeId,
    kind: subject.kind,
    accountId: subject.id,
    organizationId: subject.organizationId,
    codeHash: hashSignInCode(challengeId, code),
    channel: plan.channel,
    destination: plan.masked,
    nextPath: nextPath || null,
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
  });

  const userId = subject.kind === 'user' ? subject.id : null;
  const result =
    plan.channel === 'sms'
      ? await sendSms({ organizationId: subject.organizationId, userId, to: plan.to, template: 'sign_in_code', ...signInCodeSms({ code, minutes: CODE_MINUTES }) })
      : await sendEmail({
          organizationId: subject.organizationId,
          userId,
          to: plan.to,
          template: 'sign_in_code',
          ...signInCodeEmail({ name: subject.name, code, minutes: CODE_MINUTES }),
        });

  return { ok: true, challengeId, channel: plan.channel, masked: plan.masked, delivered: result.status, sendError: result.ok ? null : result.error };
}

// Checks a code. On success returns { ok: true, account } (the fresh
// loadSignInAccount result, ready to become a session); otherwise
// { ok: false, error, restart } — restart:true means go back to /login.
export async function verifySignInChallenge(challengeId, codeRaw) {
  const code = String(codeRaw || '').replace(/\D/g, '');
  const challenge = challengeId ? await db.getSignInChallenge(challengeId) : null;
  if (!challenge || challenge.consumedAt) return { ok: false, restart: true, error: 'That sign-in has ended. Sign in again.' };
  if (new Date(challenge.expiresAt) <= new Date()) return { ok: false, restart: true, error: 'That code has expired. Sign in again to get a new one.' };

  const attempts = await db.recordSignInChallengeAttempt(challenge.id);
  if (attempts === null) return { ok: false, restart: true, error: 'That sign-in has ended. Sign in again.' };
  if (attempts > CODE_MAX_ATTEMPTS) {
    await db.consumeSignInChallenge(challenge.id);
    return { ok: false, restart: true, error: 'Too many wrong codes. Sign in again to get a new one.' };
  }
  if (code.length !== 6 || !sameHex(hashSignInCode(challenge.id, code), challenge.codeHash)) {
    const left = CODE_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      restart: left <= 0,
      error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Sign in again to get a new one.',
    };
  }
  if (!(await db.consumeSignInChallenge(challenge.id))) return { ok: false, restart: true, error: 'That sign-in has ended. Sign in again.' };

  const account = await db.loadSignInAccount(challenge.kind, challenge.accountId);
  if (!account.ok) return { ok: false, restart: true, error: account.error };
  return { ok: true, account, nextPath: challenge.nextPath };
}

// ---------------------------------------------------------------------------
// Welcome / invite
// ---------------------------------------------------------------------------

// A new account (team member, caregiver login, a new agency's first admin)
// gets a welcome email whose button lets them choose their own password —
// a reset-style link that lasts INVITE_DAYS instead of an hour. The
// starting password the office typed still works as a fallback. Never
// throws; returns the sendEmail result, or null if there's no such account.
export async function sendWelcomeInvite(email, { baseUrl, role }) {
  const account = await db.findAccountForPasswordReset(email);
  if (!account || account.kind !== 'user' || !baseUrl) return null;
  if (!canDeliver('email')) return { ok: false, status: 'logged', error: 'Email is not connected.' };
  const token = randomBytes(32).toString('base64url');
  await db.createPasswordResetToken({
    kind: 'user',
    accountId: account.id,
    organizationId: account.organizationId,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });
  const base = String(baseUrl).replace(/\/+$/, '');
  return sendEmail({
    organizationId: account.organizationId,
    userId: account.id,
    to: account.email,
    template: 'welcome',
    fromName: account.organizationName ? `${account.organizationName} via Hearth` : undefined,
    ...welcomeEmail({
      name: account.name,
      organizationName: account.organizationName,
      email: account.email,
      role,
      days: INVITE_DAYS,
      setPasswordUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
      loginUrl: `${base}/login`,
    }),
  });
}
