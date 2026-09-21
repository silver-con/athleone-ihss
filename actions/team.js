'use server';

import { revalidatePath } from 'next/cache';
import { queryOne } from '@/lib/db';
import { requirePermission } from '@/actions/auth';
import { hashPassword } from '@/lib/auth';
import { createOrgUser } from '@/lib/queries';

// Organization staffing. Before this existed there was no way to create an
// ADMIN, LOCATION_ADMIN or COORDINATOR account through the UI at all — only
// caregivers — which made LOCATION_ADMIN unusable the day it was added.
//
// Org-admin only, deliberately: deciding who runs a location is the
// organization's call, not the location's. A location admin staffing its
// own branch (with COORDINATOR/CAREGIVER accounts) is a reasonable future
// extension, but it needs its own permission key rather than widening this
// one, since this action can also mint another organization-wide ADMIN.
export async function createTeamMemberAction(prevState, formData) {
  const session = await requirePermission('admin.team.manage');

  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const role = String(formData.get('role') || '').trim();
  const locationIdRaw = String(formData.get('locationId') || '').trim();
  const locationId = locationIdRaw || null;

  if (!name || !email || !password || !role) {
    return { error: 'Name, email, a starting password and a role are all required.', success: null };
  }
  if (password.length < 8) {
    return { error: 'Use a starting password of at least 8 characters.', success: null };
  }
  if (!['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR'].includes(role)) {
    return { error: 'Pick a valid role.', success: null };
  }
  if (role === 'LOCATION_ADMIN' && !locationId) {
    return { error: 'A location admin has to be assigned to a location.', success: null };
  }
  if (role === 'ADMIN' && locationId) {
    return { error: 'An organization admin sees every location and cannot be scoped to one.', success: null };
  }

  // Email is globally unique across users, and loginAction checks the users
  // table before platform_admins, so a collision with either would break
  // sign-in for the existing account.
  const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser) {
    return { error: 'An account with that email already exists.', success: null };
  }
  const existingPlatformAdmin = await queryOne('SELECT id FROM platform_admins WHERE email = $1', [email]);
  if (existingPlatformAdmin) {
    return { error: 'That email is already in use on a platform admin account.', success: null };
  }

  try {
    await createOrgUser(session.organizationId, {
      name,
      email,
      role,
      locationId,
      passwordHash: await hashPassword(password),
    });
  } catch (err) {
    return { error: err.message || 'Could not create the account.', success: null };
  }

  revalidatePath('/admin/team');
  return {
    error: null,
    success: `${name} added as ${role === 'LOCATION_ADMIN' ? 'a location admin' : role === 'ADMIN' ? 'an organization admin' : 'a coordinator'}. Pass them the password you just set.`,
  };
}
