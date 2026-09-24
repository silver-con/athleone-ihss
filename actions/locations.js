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

  if (!name) {
    return { error: 'Location name is required.', success: null };
  }

  // Commission is intentionally not exposed here — it was a one-off
  // franchise idea, not a default feature. createLocation() leaves it at
  // the schema default (0) for every new location. Re-introduce it as an
  // opt-in, per-org control-panel setting rather than a form field here if
  // it's ever needed again — see claude/deferred-backlog.md.
  await createLocation(session.organizationId, { name });
  revalidatePath('/admin/locations');

  return { error: null, success: `${name} added.` };
}

// Configuring a location after creation — commission terms get
// renegotiated and branches get retired, so create-only wasn't survivable.
export async function updateLocationAction(prevState, formData) {
  const session = await requirePermission('admin.locations.manage');

  const id = String(formData.get('locationId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const status = String(formData.get('status') || '').trim();

  if (!id) return { error: 'Which location?', success: null };
  if (!name) return { error: 'Location name is required.', success: null };
  if (!['active', 'inactive'].includes(status)) {
    return { error: 'Status must be active or inactive.', success: null };
  }

  // Commission isn't editable from this form (see createLocationAction) —
  // omitting it from the update leaves whatever value is already on the
  // row untouched, rather than resetting it to 0.
  try {
    await updateLocation(session.organizationId, id, { name, status });
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
