'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// session.locationId is threaded through to every write below as
// defense-in-depth: today every ADMIN/COORDINATOR account has
// locationId === null (agency-wide — there's no UI yet to create a
// location-scoped admin, see db/schema.sql's comment on users.location_id
// and app/admin/locations/page.js's note), so this is currently a no-op
// for every real session. It's here so a future location-scoped manager
// role works correctly the day it's added, without another pass through
// this file.
export async function toggleCaregiverStatusAction(caregiverId) {
  const session = await requirePermission('admin.caregivers.manage');
  await db.toggleCaregiverStatus(session.organizationId, caregiverId, session.locationId);
  revalidatePath('/admin/caregivers');
  revalidatePath('/admin/schedule');
  revalidatePath('/admin');
}

export async function assignCaregiverAction(clientId, caregiverId) {
  const session = await requirePermission('admin.clients.manage');
  await db.assignCaregiver(session.organizationId, clientId, caregiverId, session.locationId);
  revalidatePath('/admin/clients');
  revalidatePath('/admin');
}

export async function resolveVisitExceptionAction(visitId) {
  const session = await requirePermission('admin.evv.exceptions.manage');
  await db.resolveVisitException(session.organizationId, visitId, session.locationId);
  revalidatePath('/admin/evv');
  revalidatePath('/admin/compliance');
  revalidatePath('/admin');
}

export async function submitVMURAction(visitId) {
  const session = await requirePermission('admin.evv.exceptions.manage');
  await db.submitVMUR(session.organizationId, visitId, session.locationId);
  revalidatePath('/admin/compliance');
  revalidatePath('/admin');
}
