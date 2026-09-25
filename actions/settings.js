'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { canDeliver } from '@/lib/sign-in';

// Agency settings page (/admin/settings). The first two entries of the
// per-agency "configurator" — see vesta-evv-feature-reference.md.
export async function updateEvvSettingsAction(prevState, formData) {
  const session = await requirePermission('admin.settings.manage');
  const before = await db.getOrganization(session.organizationId);
  const next = {
    flexibleHoursEnabled: formData.get('flexibleHoursEnabled') === 'on',
    graceMinutes: String(formData.get('graceMinutes') ?? '').trim(),
    maintenanceWindowDays: String(formData.get('maintenanceWindowDays') ?? '').trim(),
    homeRadiusFeet: String(formData.get('homeRadiusFeet') ?? '').trim(),
    overlapDistanceFeet: String(formData.get('overlapDistanceFeet') ?? '').trim(),
  };
  try {
    await db.updateOrganizationEvvSettings(session.organizationId, next);
  } catch (err) {
    return { error: err.message || 'Could not save settings.', success: null };
  }
  const after = await db.getOrganization(session.organizationId);
  const changes = [];
  if (before.flexibleHoursEnabled !== after.flexibleHoursEnabled) changes.push(`flexible hours ${after.flexibleHoursEnabled ? 'on' : 'off'}`);
  if (before.flexibleHoursGraceMinutes !== after.flexibleHoursGraceMinutes) changes.push(`grace ${before.flexibleHoursGraceMinutes} -> ${after.flexibleHoursGraceMinutes} min`);
  if (before.visitMaintenanceWindowDays !== after.visitMaintenanceWindowDays) {
    changes.push(`maintenance deadline ${before.visitMaintenanceWindowDays ?? 'state'} -> ${after.visitMaintenanceWindowDays ?? 'state'} days`);
  }
  if (before.overlapDistanceFeet !== after.overlapDistanceFeet) changes.push(`overlap distance ${before.overlapDistanceFeet} -> ${after.overlapDistanceFeet} ft`);
  if (before.homeRadiusFeet !== after.homeRadiusFeet) changes.push(`home radius ${before.homeRadiusFeet} -> ${after.homeRadiusFeet} ft`);
  if (changes.length === 0) return { error: null, success: 'No changes.' };
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_agency_settings',
    entityType: 'organization',
    entityId: session.organizationId,
    detail: changes.join('; '),
  });
  revalidatePath('/admin/settings');
  return { error: null, success: 'Settings saved.' };
}

// /admin/settings "Sign-in security" — require two-step sign-in for every
// office account in this agency.
export async function updateSignInSecurityAction(prevState, formData) {
  const session = await requirePermission('admin.settings.manage');
  const required = formData.get('requireTwoFactor') === 'on';
  const before = await db.getOrganization(session.organizationId);
  if (Boolean(before.requireTwoFactor) === required) return { error: null, success: 'No changes.' };
  if (required && !canDeliver('email')) {
    return { error: 'Connect email first (Communications page) — otherwise office staff couldn’t receive their codes.', success: null };
  }
  await db.updateOrganizationRequireTwoFactor(session.organizationId, required);
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_agency_settings',
    entityType: 'organization',
    entityId: session.organizationId,
    detail: `two-step sign-in for office accounts ${required ? 'required' : 'optional'}`,
  });
  revalidatePath('/admin/settings');
  return {
    error: null,
    success: required
      ? 'Required. Office staff will get a code by email at their next sign-in (or by text, if they chose that).'
      : 'Two-step sign-in is now optional for office staff.',
  };
}
