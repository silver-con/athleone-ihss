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
import { createSessionToken, verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/session';

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
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// Reads + verifies the session from a Server Component / Server Action.
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
