// Hand-rolled auth: bcrypt for password hashing, a signed JWT in an
// httpOnly cookie for the session (via `jose`, see lib/session.js), and
// middleware.js for route protection by role. No NextAuth/Auth.js —
// Next.js 16 is new enough that pulling in a large auth library felt like
// a bigger compatibility risk than this much hand-written session code.
//
// This file is for use in Server Components / Server Actions only (it
// touches next/headers and bcryptjs, which don't belong in middleware's
// Edge runtime) — middleware.js imports lib/session.js directly instead.
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { createSessionToken, verifySessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { getSessionAccountState } from '@/lib/queries';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Sets the session cookie — call from a Server Action.
export async function setSessionCookie(payload) {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// Reads + verifies the session from a Server Component / Server Action.
// A valid signature is not enough on its own: the token may be hours old,
// and since then the account could have been deactivated, had its role or
// location changed, had its password reset, or its agency suspended. So
// every call re-checks the account row (one indexed lookup) and returns
// null — treated everywhere as "signed out" — if the session should no
// longer be honoured. Role, location, name and the must-change-password
// flag are taken from the database, not the token.
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const fresh = await getSessionAccountState(payload);
  if (!fresh) return null;
  return { ...payload, ...fresh };
}
