'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function createOrientationAction(formData) {
  const session = await requirePermission('admin.orientations.manage');
  const clientId = String(formData.get('clientId') || '').trim();
  const caregiverId = String(formData.get('caregiverId') || '').trim();
  const orientationType = String(formData.get('orientationType') || 'initial').trim();

  if (!clientId || !caregiverId) return;

  const id = await db.createOrientation(session.organizationId, {
    clientId,
    caregiverId,
    orientationType,
  });

  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  redirect(`/admin/orientations/${id}`);
}

export async function completeOrientationAction(formData) {
  const session = await requirePermission('admin.orientations.manage');
  const orientationId = String(formData.get('orientationId') || '').trim();
  const clientId = String(formData.get('clientId') || '').trim();

  await db.completeOrientation(session.organizationId, orientationId, {
    method: String(formData.get('method') || '').trim() || null,
    orientedOn: String(formData.get('orientedOn') || '').trim() || null,
    agencyRepName: String(formData.get('agencyRepName') || '').trim() || null,
    notes: String(formData.get('notes') || '').trim() || null,
  });

  revalidatePath(`/admin/orientations/${orientationId}`);
  if (clientId) revalidatePath(`/admin/clients/${clientId}/care-plan`);
}
