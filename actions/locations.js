'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import {
  createLocation,
  updateLocation,
  setCaregiverLocation,
  setClientLocation,
} from '@/lib/queries';

// Org-admin-only, per lib/permissions.js's note on admin.locations.manage —
// a location is a franchise/branch grant under the agency's own license,
// not something a location itself creates. This intentionally does NOT
// take a locationId, unlike the caregiver/client/visit actions in
// actions/admin.js — creating a location is by definition an org-wide
// action.
export async function createLocationAction(prevState, formData) {
  const session = await requirePermission('admin.locations.manage');

  const name = String(formData.get('name') || '').trim();
  const commissionRateRaw = String(formData.get('commissionRate') || '').trim();
  const commissionRate = commissionRateRaw === '' ? 0 : Number(commissionRateRaw);

  if (!name) {
    return { error: 'Location name is required.', success: null };
  }
  if (Number.isNaN(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    return { error: 'Commission rate must be a number between 0 and 100.', success: null };
  }

  await createLocation(session.organizationId, { name, commissionRate });
  revalidatePath('/admin/locations');

  return { error: null, success: `${name} added.` };
}

// Configuring a location after creation — commission terms get
// renegotiated and branches get retired, so create-only wasn't survivable.
export async function updateLocationAction(prevState, formData) {
  const session = await requirePermission('admin.locations.manage');

  const id = String(formData.get('locationId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const commissionRateRaw = String(formData.get('commissionRate') || '').trim();
  const status = String(formData.get('status') || '').trim();

  if (!id) return { error: 'Which location?', success: null };
  if (!name) return { error: 'Location name is required.', success: null };
  if (!['active', 'inactive'].includes(status)) {
    return { error: 'Status must be active or inactive.', success: null };
  }
  const commissionRate = commissionRateRaw === '' ? 0 : Number(commissionRateRaw);
  if (Number.isNaN(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    return { error: 'Commission rate must be a number between 0 and 100.', success: null };
  }

  try {
    await updateLocation(session.organizationId, id, { name, commissionRate, status });
  } catch (err) {
    return { error: err.message || 'Could not update the location.', success: null };
  }

  revalidatePath('/admin/locations');
  revalidatePath('/admin/caregivers');
  revalidatePath('/admin/clients');
  return { error: null, success: `${name} updated.` };
}

// Moving an existing caregiver or client into a location. Every row that
// predates the locations feature has location_id NULL; locations are now
// required for new records, so without these those rows stay stranded
// outside every location and outside the franchise rollup.
export async function setCaregiverLocationAction(caregiverId, locationId) {
  const session = await requirePermission('admin.locations.manage');
  await setCaregiverLocation(session.organizationId, caregiverId, locationId || null);
  revalidatePath('/admin/caregivers');
  revalidatePath('/admin/locations');
  revalidatePath('/admin');
}

export async function setClientLocationAction(clientId, locationId) {
  const session = await requirePermission('admin.locations.manage');
  await setClientLocation(session.organizationId, clientId, locationId || null);
  revalidatePath('/admin/clients');
  revalidatePath('/admin/locations');
  revalidatePath('/admin');
}
