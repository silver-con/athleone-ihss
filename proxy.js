import { NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/session';
import { ROUTE_PERMISSIONS, PERMISSIONS, ROLE_HOME, CHANGE_PASSWORD_PATH } from '@/lib/permissions';

// Which top-level sections require a session at all. Anything not matched
// here (the landing page, /login, /signup, static assets) is public. This
// list is intentionally still just the coarse prefixes — it only answers
// "does this need a login," not "which role" — that question is answered
// per-route below, by lib/permissions.js's ROUTE_PERMISSIONS table.
const PROTECTED_PREFIXES = ['/referrals', '/clients', '/fax', '/admin', '/caregiver', '/platform', '/account'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Look up the specific permission this route needs from the single
  // catalog in lib/permissions.js (also what every Server Action checks
  // against via requirePermission()), rather than a role-vs-prefix table
  // that couldn't tell two pages under the same prefix apart. Every
  // protected prefix ends with a catch-all entry, so this should always
  // find a match; the null-check below is a fail-safe, not an expected path.
  // Starting or just-reset password: nothing else until it's replaced.
  // (This reads the token claim set at sign-in. The authoritative check is
  // lib/auth.js getSession, which re-reads the flag from the database.)
  if (session.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
  }

  const match = ROUTE_PERMISSIONS.find((r) => r.test(pathname));
  const allowed = match ? (PERMISSIONS[match.key]?.roles || []).includes(session.role) : false;

  if (!allowed) {
    // Signed in, but this account's role doesn't hold the permission this
    // route needs — send them to the home base for their own role instead
    // of a raw 403. Same ROLE_HOME map actions/auth.js uses after login —
    // this used to be its own inline copy that never learned about
    // LOCATION_ADMIN, so that role fell through to '/referrals' instead
    // of its actual home.
    const home = ROLE_HOME[session.role] || '/referrals';
    return NextResponse.redirect(new URL(home, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/referrals/:path*',
    '/clients/:path*',
    '/fax/:path*',
    '/admin/:path*',
    '/caregiver/:path*',
    '/platform/:path*',
    '/account/:path*',
  ],
};
