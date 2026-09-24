'use server';

import { revalidatePath } from 'next/cache';
import { queryOne } from '@/lib/db';
import { requirePermission } from '@/actions/auth';
import { hashPassword } from '@/lib/auth';
import {
  createOrgUser,
  getOrgUser,
  setOrgUserActive,
  updateOrgUserAccess,
  resetOrgUserPassword,
  resetCaregiverLoginPassword,
  logAuditEvent,
} from '@/lib/queries';
import { passwordProblem, generateTemporaryPassword } from '@/lib/passwords';

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
  const problem = passwordProblem(password, { email, name });
  if (problem) {
    return { error: `Starting password: ${problem}`, success: null };
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

  let newUserId;
  try {
    newUserId = await createOrgUser(session.organizationId, {
      name,
      email,
      role,
      locationId,
      passwordHash: await hashPassword(password),
    });
  } catch (err) {
    return { error: err.message || 'Could not create the account.', success: null };
  }

  await audit(session, 'create_team_member', newUserId, `${role}${locationId ? ' (location-scoped)' : ''}`);

  revalidatePath('/admin/team');
  return {
    error: null,
    success: `${name} added as ${role === 'LOCATION_ADMIN' ? 'a location admin' : role === 'ADMIN' ? 'an organization admin' : 'a coordinator'}. They'll be asked to choose their own password the first time they sign in.`,
  };
}

async function audit(session, action, entityId, detail) {
  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action,
    entityType: 'user',
    entityId,
    detail,
  });
}

// Deactivate or reactivate an office account. Deactivation takes effect on
// the person's very next request, not when their session would expire.
export async function setTeamMemberActiveAction(prevState, formData) {
  const session = await requirePermission('admin.team.manage');
  const userId = String(formData.get('userId') || '').trim();
  const active = String(formData.get('active') || '') === 'true';
  let target;
  try {
    target = await getOrgUser(session.organizationId, userId);
    const changed = await setOrgUserActive(session.organizationId, session.userId, userId, active);
    if (!changed) return { error: null, success: 'No change.' };
  } catch (err) {
    return { error: err.message || 'Could not update the account.', success: null };
  }
  await audit(session, active ? 'reactivate_team_member' : 'deactivate_team_member', userId, target?.email || null);
  revalidatePath('/admin/team');
  return {
    error: null,
    success: active
      ? `${target.name} can sign in again.`
      : `${target.name} is deactivated and has been signed out everywhere.`,
  };
}

export async function updateTeamMemberAccessAction(prevState, formData) {
  const session = await requirePermission('admin.team.manage');
  const userId = String(formData.get('userId') || '').trim();
  const role = String(formData.get('role') || '').trim();
  const locationId = String(formData.get('locationId') || '').trim() || null;
  let before;
  try {
    before = await getOrgUser(session.organizationId, userId);
    const changed = await updateOrgUserAccess(session.organizationId, session.userId, userId, { role, locationId });
    if (!changed) return { error: null, success: 'No change.' };
  } catch (err) {
    return { error: err.message || 'Could not update the account.', success: null };
  }
  await audit(session, 'change_team_member_access', userId, `${before?.role} -> ${role}${locationId ? ' (location-scoped)' : ''}`);
  revalidatePath('/admin/team');
  return { error: null, success: `Access updated. ${before.name} will be asked to sign in again.` };
}

// Admin reset. Returns the temporary password ONCE, for the admin to pass
// on; it is never stored or logged in plain text, and the person must
// replace it at their next sign-in.
export async function resetTeamMemberPasswordAction(prevState, formData) {
  const session = await requirePermission('admin.team.manage');
  const userId = String(formData.get('userId') || '').trim();
  const temporary = generateTemporaryPassword();
  let target;
  try {
    target = await resetOrgUserPassword(session.organizationId, session.userId, userId, await hashPassword(temporary));
  } catch (err) {
    return { error: err.message || 'Could not reset the password.', success: null, temporaryPassword: null };
  }
  await audit(session, 'reset_team_member_password', userId, target.email);
  revalidatePath('/admin/team');
  return {
    error: null,
    success: `Temporary password for ${target.name}. Share it privately — it's shown only once, and they'll set their own at next sign-in. They've been signed out everywhere.`,
    temporaryPassword: temporary,
  };
}

export async function resetCaregiverPasswordAction(prevState, formData) {
  const session = await requirePermission('admin.caregivers.login.manage');
  const caregiverId = String(formData.get('caregiverId') || '').trim();
  const temporary = generateTemporaryPassword();
  let result;
  try {
    result = await resetCaregiverLoginPassword(
      session.organizationId,
      caregiverId,
      await hashPassword(temporary),
      session.locationId
    );
  } catch (err) {
    return { error: err.message || 'Could not reset the password.', success: null, temporaryPassword: null };
  }
  await audit(session, 'reset_caregiver_password', result.userId, result.email);
  revalidatePath(`/admin/caregivers/${caregiverId}`);
  return {
    error: null,
    success: `Temporary password for ${result.caregiverName}. Share it privately — it's shown only once, and they'll set their own at next sign-in.`,
    temporaryPassword: temporary,
  };
}
