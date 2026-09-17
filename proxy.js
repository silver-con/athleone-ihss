import { NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/session';

// Path prefixes each role is allowed into. Anything not matched here (the
// landing page, /login, static assets) is public.
const ROLE_PREFIXES = {
  COORDINATOR: ['/referrals', '/clients', '/fax'],
  ADMIN: ['/admin', '/referrals', '/clients', '/fax'],
  CAREGIVER: ['/caregiver'],
};

const PROTECTED_PREFIXES = ['/referrals', '/clients', '/fax', '/admin', '/caregiver'];

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

  const allowedPrefixes = ROLE_PREFIXES[session.role] || [];
  const allowed = allowedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!allowed) {
    // Signed in, but this account's role doesn't cover this section —
    // send them to the home base for their own role instead of a raw 403.
    const home = session.role === 'ADMIN' ? '/admin' : session.role === 'CAREGIVER' ? '/caregiver' : '/referrals';
    return NextResponse.redirect(new URL(home, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/referrals/:path*', '/clients/:path*', '/fax/:path*', '/admin/:path*', '/caregiver/:path*'],
};
