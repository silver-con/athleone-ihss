// JWT sign/verify only — no bcrypt, no next/headers. Kept separate from
// lib/auth.js so middleware.js (which runs in the Edge runtime) can import
// just this, without pulling in bcryptjs or the Server-Components-only
// `cookies()` API.
import { SignJWT, jwtVerify } from 'jose';

// 12 hours (was 7 days until 2026-09-23). Long enough for a caregiver's
// working day, short enough that a lost or shared device doesn't stay
// signed in to PHI for a week. Deactivation/role changes don't wait for
// this to expire — lib/auth.js getSession re-checks the account on every
// request (see getSessionAccountState in lib/queries.js).
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const SESSION_DURATION = `${SESSION_MAX_AGE_SECONDS}s`;

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set — add it to your .env file (see .env.example).');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretKey());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = 'hearth_session';
