'use server';

import { sendWelcomeInvite } from '@/lib/sign-in';
import { trustedBaseUrl } from '@/lib/request-url';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import { hashPassword } from '@/lib/auth';
import { passwordProblem } from '@/lib/passwords';
import {
  createOrganizationWithAdmin,
  logPlatformAdminAccess,
  createPlatformAdmin,
  setPlatformAdminActive,
  getPlatformAdminById,
  countActiveFullPlatformAdmins,
} from '@/lib/queries';

// Platform admin onboarding a new agency directly — the first *write*
// action this role has ever had. Everything else on /platform is
// deliberately read-only (see deferred-backlog.md's "Platform / vendor-ops
// admin role" entry and app/platform/page.js's top comment) — this one
// narrow exception was added 2026-09-17 because it doesn't touch any
// *existing* tenant's data at all: it only creates a brand-new one, using
// the exact same createOrganizationWithAdmin transaction the agency's own
// self-service /signup uses (actions/signup.js). A platform admin still
// cannot view, edit, suspend, or log into any organization that already
// exists — that boundary is untouched.
//
// Unlike signupAction, this does NOT call setSessionCookie — the platform
// admin creating the account is not the person who should be logged into
// it. They stay signed in as themselves and are handed back the new
// admin's login to pass along to the agency out of band, same convention
// components/admin/AddCaregiverForm.js already uses for caregiver logins.
export async function createOrganizationAction(prevState, formData) {
  const session = await requirePermission('platform.organizations.create');

  // Sub-role gate: every platform admin can VIEW every agency (§3), but
  // onboarding a new one is 'full'-only — see db/schema.sql's comment on
  // platform_admins.platform_role. A 'support' admin never sees this form
  // rendered (app/platform/page.js checks the same field), so this is
  // defense in depth against a direct action call, not the primary guard.
  if (session.platformRole !== 'full') {
    return {
      error: 'Only full platform admins can onboard a new agency — ask one on your team.',
      success: null,
    };
  }

  const organizationName = String(formData.get('organizationName') || '').trim();
  const adminName = String(formData.get('adminName') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const state = String(formData.get('state') || '').trim().toUpperCase();
  const medicaidProviderNumber = String(formData.get('medicaidProviderNumber') || '').trim();
  const npi = String(formData.get('npi') || '').trim();
  const stateLicenseNumber = String(formData.get('stateLicenseNumber') || '').trim();

  if (!organizationName || !adminName || !email || !password) {
    return { error: 'Agency name, admin name, email, and a starting password are all required.', success: null };
  }
  const adminPasswordIssue = passwordProblem(password, { email, name: adminName });
  if (adminPasswordIssue) {
    return { error: `Starting password: ${adminPasswordIssue}`, success: null };
  }

  let result;
  try {
    const passwordHash = await hashPassword(password);
    result = await createOrganizationWithAdmin({
      organizationName,
      adminName,
      email,
      passwordHash,
      state,
      medicaidProviderNumber,
      npi,
      stateLicenseNumber,
    });
  } catch (err) {
    return { error: err.message || 'Could not create this agency. Please try again.', success: null };
  }

  // Same audit table every /platform view already logs to — this is the
  // first *action* (not just a view) it records.
  await logPlatformAdminAccess(
    session.userId,
    'create_organization',
    `Created "${organizationName}" (org ${result.organizationId}), admin ${email}`
  );

  await sendWelcomeInvite(email, { baseUrl: await trustedBaseUrl(), role: 'ADMIN' });
  revalidatePath('/platform');

  return {
    error: null,
    success: { organizationName, adminName, email },
  };
}
// Platform team management — added alongside app/platform/admins, the
// screen for managing platform admins themselves (support staff, other
// vendor-ops admins) rather than agencies. createPlatformAdminAction grants
// someone PLATFORM_ADMIN access directly from the UI — previously only
// scripts/create-platform-admin.mjs, run by hand against the database,
// could do this (see that script's comment on why provisioning this role
// was kept deliberately manual). Doing it from the UI now is reasonable
// because the actor granting the access is already themselves a signed-in,
// audit-logged platform admin — the same trust boundary
// scripts/create-platform-admin.mjs relied on ("a person with real
// database access"), just exercised through the app instead of a shell.
// That script still works too; this doesn't replace it.
//
// togglePlatformAdminActiveAction lets that same admin deactivate (or
// reactivate) another platform admin's login — e.g. when someone leaves
// the team — without touching the row directly in the database. It
// refuses to let someone deactivate themselves (see the check below); the
// UI (components/platform/PlatformAdminStatusToggle.js, used from
// app/platform/admins) also just doesn't render the toggle for the
// caller's own row, so this is defense in depth, not the only guard.
const PLATFORM_ROLES = ['support', 'full'];

export async function createPlatformAdminAction(prevState, formData) {
  const session = await requirePermission('platform.admins.create');

  // Same sub-role gate as createOrganizationAction above — 'support'
  // admins can view this page but not add to it. Not rendered for them in
  // the first place (app/platform/admins/page.js), so this is defense in
  // depth, not the primary guard.
  if (session.platformRole !== 'full') {
    return {
      error: 'Only full platform admins can add a platform admin — ask one on your team.',
      success: null,
    };
  }

  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const platformRole = String(formData.get('platformRole') || '').trim();

  if (!name || !email || !password) {
    return { error: 'Name, email, and a starting password are all required.', success: null };
  }
  const platformPasswordIssue = passwordProblem(password, { email, name });
  if (platformPasswordIssue) {
    return { error: `Starting password: ${platformPasswordIssue}`, success: null };
  }
  if (!PLATFORM_ROLES.includes(platformRole)) {
    return { error: 'Choose a role: Support or Full admin.', success: null };
  }

  let created;
  try {
    const passwordHash = await hashPassword(password);
    created = await createPlatformAdmin({ name, email, passwordHash, platformRole });
  } catch (err) {
    return { error: err.message || 'Could not create this platform admin. Please try again.', success: null };
  }

  await logPlatformAdminAccess(
    session.userId,
    'create_platform_admin',
    `Created platform admin ${created.email} (id ${created.id}, role: ${platformRole})`
  );

  revalidatePath('/platform/admins');

  return { error: null, success: { name, email, platformRole } };
}

// No prevState/formData here — invoked directly from a button via
// useTransition, same convention as
// components/admin/CaregiverStatusToggle.js / toggleCaregiverStatusAction.
// So unlike createPlatformAdminAction above, there's no field to render an
// error into — every guard below is either unreachable through the normal
// UI (the button isn't rendered for a case it would block) or, same as
// the pre-existing self-deactivation guard, throws and relies on that.
export async function togglePlatformAdminActiveAction(platformAdminId, nextActive) {
  const session = await requirePermission('platform.admins.manage');

  if (session.platformRole !== 'full') {
    throw new Error('Only full platform admins can activate or deactivate a platform admin.');
  }

  if (platformAdminId === session.userId) {
    throw new Error('You cannot deactivate your own platform admin account.');
  }

  // Don't let the team lock itself out: if this would deactivate the last
  // active 'full' admin, refuse — past that point nobody left could
  // onboard an agency or manage the roster without falling back to
  // scripts/create-platform-admin.mjs run directly against the database.
  if (!nextActive) {
    const target = await getPlatformAdminById(platformAdminId);
    if (target?.platformRole === 'full' && target.active) {
      const activeFullCount = await countActiveFullPlatformAdmins();
      if (activeFullCount <= 1) {
        throw new Error(
          'You cannot deactivate the last active full platform admin — activate or add another one first.'
        );
      }
    }
  }

  await setPlatformAdminActive(platformAdminId, nextActive);

  await logPlatformAdminAccess(
    session.userId,
    nextActive ? 'activate_platform_admin' : 'deactivate_platform_admin',
    `Platform admin id ${platformAdminId}`
  );

  revalidatePath('/platform/admins');
}
