'use server';

import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { getPlatformAdminByEmail } from '@/lib/queries';
import { verifyPassword, setSessionCookie, clearSessionCookie, getSession } from '@/lib/auth';
import { PERMISSIONS } from '@/lib/permissions';

const ROLE_HOME = {
  ADMIN: '/admin',
  // A location admin lands on the same dashboard as the org admin — the
  // pages are shared and every query narrows on session.locationId, so
  // they simply see their own location's slice of it.
  LOCATION_ADMIN: '/admin',
  COORDINATOR: '/referrals',
  CAREGIVER: '/caregiver',
  PLATFORM_ADMIN: '/platform',
};

export async function loginAction(prevState, formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '');

  if (!email || !password) {
    return { error: 'Enter both an email and a password.' };
  }

  // Same login form for every role, platform admins included — there is
  // no separate "platform sign-in" page, since that account isn't a row
  // in `users` at all (see db/schema.sql's platform_admins comment and
  // lib/queries.js's Platform admin section). Check the tenant-scoped
  // users table first since that's the overwhelming majority of logins,
  // then fall back to platform_admins.
  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (user) {
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return { error: 'Incorrect password.' };
    }
    await setSessionCookie({
      userId: user.id,
      organizationId: user.organization_id,
      email: user.email,
      name: user.name,
      role: user.role,
      caregiverId: user.caregiver_id,
      // Location scope for franchise/multi-location agencies — null means
      // agency-wide (every current ADMIN/COORDINATOR, since there's no UI
      // yet to scope those roles to a location; see db/schema.sql's
      // comment on users.location_id). lib/queries.js's getters treat a
      // null locationId as "no filter", so this is a no-op for every
      // existing account until locations are actually assigned.
      locationId: user.location_id,
    });
    redirect(next && next.startsWith('/') ? next : ROLE_HOME[user.role] || '/');
  }

  const platformAdmin = await getPlatformAdminByEmail(email);
  if (platformAdmin) {
    const valid = await verifyPassword(password, platformAdmin.passwordHash);
    if (!valid) {
      return { error: 'Incorrect password.' };
    }
    if (!platformAdmin.active) {
      return { error: 'This platform admin account has been deactivated.' };
    }
    await setSessionCookie({
      userId: platformAdmin.id,
      organizationId: null,
      email: platformAdmin.email,
      name: platformAdmin.name,
      role: 'PLATFORM_ADMIN',
      // Sub-role WITHIN the platform-admin role — 'support' or 'full', see
      // db/schema.sql's comment on platform_admins.platform_role. Every
      // requireSession(['PLATFORM_ADMIN']) check is unaffected by this
      // (both sub-roles still pass); actions/platform.js's write actions
      // are what actually read session.platformRole.
      platformRole: platformAdmin.platformRole,
      caregiverId: null,
    });
    redirect(next && next.startsWith('/') ? next : ROLE_HOME.PLATFORM_ADMIN);
  }

  return { error: 'No account found with that email.' };
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
