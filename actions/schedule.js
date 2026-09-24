'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function createVisitAction(prevState, formData) {
  const session = await requirePermission('admin.schedule.manage');

  const data = {
    caregiverId: String(formData.get('caregiverId') || ''),
    clientId: String(formData.get('clientId') || ''),
    serviceDate: String(formData.get('serviceDate') || '').trim(),
    startTime: String(formData.get('startTime') || ''),
    endTime: String(formData.get('endTime') || ''),
    // Optional — db.createVisit only requires it when the client actually
    // has more than one active authorization to disambiguate between.
    serviceAuthorizationId: String(formData.get('serviceAuthorizationId') || '').trim() || undefined,
  };

  try {
    await db.createVisit(session.organizationId, data, session.locationId);
  } catch (err) {
    return { error: err.message || 'Could not schedule visit.' };
  }

  revalidatePath('/admin/schedule');
  return { error: null, success: 'Visit scheduled.' };
}
