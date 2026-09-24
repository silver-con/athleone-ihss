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

// Visit maintenance — the audited replacement for the old one-click
// "Mark reviewed" / "Submit VMUR" buttons (removed 2026-09-23). Both go
// through lib/queries.js, which enforces HHSC's rules; see
// performVisitMaintenance / recordVisitVmur there.
export async function performVisitMaintenanceAction(prevState, formData) {
  const session = await requirePermission('admin.evv.exceptions.manage');
  const visitId = String(formData.get('visitId') || '').trim();
  try {
    await db.performVisitMaintenance(
      session.organizationId,
      visitId,
      {
        contact: String(formData.get('contact') || ''),
        reasonCodes: formData.getAll('reasonCodes').map(String),
        note: String(formData.get('note') || ''),
        manualClockIn: String(formData.get('manualClockIn') || ''),
        manualClockOut: String(formData.get('manualClockOut') || ''),
        verified: formData.get('verified') === 'on',
      },
      { userId: session.userId, name: session.name, role: session.role, locationId: session.locationId }
    );
  } catch (err) {
    return { error: err.message || 'Could not save the visit maintenance.', success: null };
  }
  revalidateVisitPages(visitId);
  return { error: null, success: 'Visit maintenance saved and verified.' };
}

export async function recordVisitVmurAction(prevState, formData) {
  const session = await requirePermission('admin.evv.exceptions.manage');
  const visitId = String(formData.get('visitId') || '').trim();
  try {
    await db.recordVisitVmur(
      session.organizationId,
      visitId,
      {
        justification: String(formData.get('justification') || ''),
        payerReference: String(formData.get('payerReference') || ''),
      },
      { userId: session.userId, name: session.name, role: session.role, locationId: session.locationId }
    );
  } catch (err) {
    return { error: err.message || 'Could not record the VMUR.', success: null };
  }
  revalidateVisitPages(visitId);
  return { error: null, success: 'VMUR recorded.' };
}

function revalidateVisitPages(visitId) {
  revalidatePath(`/admin/evv/visits/${visitId}`);
  revalidatePath('/admin/evv');
  revalidatePath('/admin/compliance');
  revalidatePath('/admin');
}
