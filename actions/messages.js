'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { notifyCaregiverOfOfficeMessage } from '@/lib/messaging';

// Office -> caregiver. Location admins can only message caregivers at their
// own location (enforced in sendOfficeMessage via locationId).
export async function sendOfficeMessageAction(caregiverId, prevState, formData) {
  const session = await requirePermission('admin.messages.send');
  const text = String(formData.get('text') || '');
  try {
    await db.sendOfficeMessage(session.organizationId, String(caregiverId), {
      senderName: session.name,
      senderUserId: session.userId,
      text,
      locationId: session.locationId || null,
    });
  } catch (err) {
    return { error: err.message || 'Could not send.' };
  }
  const notified = await notifyCaregiverOfOfficeMessage(session.organizationId, String(caregiverId), text);
  revalidatePath('/admin/messages');
  revalidatePath('/caregiver/messages');
  return { sent: Date.now(), notified };
}
