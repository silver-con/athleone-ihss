'use server';

import { redirect } from 'next/navigation';
import { authenticateLogin } from '@/lib/queries';
import { setSessionCookie, clearSessionCookie, getSession } from '@/lib/auth';
import { PERMISSIONS, ROLE_HOME, CHANGE_PASSWORD_PATH } from '@/lib/permissions';

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
    });
    redirect(next || ROLE_HOME.PLATFORM_ADMIN);
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
  if (user.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  redirect(next || ROLE_HOME[user.role] || '/');
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
