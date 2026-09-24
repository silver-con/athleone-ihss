'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// Agency settings page (/admin/settings). The first two entries of the
// per-agency "configurator" — see vesta-evv-feature-reference.md.
export async function updateEvvSettingsAction(prevState, formData) {
  const session = await requirePermission('admin.settings.manage');
  const before = await db.getOrganization(session.organizationId);
  const next = {
    flexibleHoursEnabled: formData.get('flexibleHoursEnabled') === 'on',
    graceMinutes: String(formData.get('graceMinutes') ?? '').trim(),
    maintenanceWindowDays: String(formData.get('maintenanceWindowDays') ?? '').trim(),
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
