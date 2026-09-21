'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function createCourseAction(formData) {
  const session = await requirePermission('admin.training.manage');

  const title = String(formData.get('title') || '').trim();
  if (!title) return;

  await db.createCourse(session.organizationId, {
    title,
    description: String(formData.get('description') || '').trim() || null,
    videoUrl: String(formData.get('videoUrl') || '').trim() || null,
    durationMinutes: formData.get('durationMinutes') ? Number(formData.get('durationMinutes')) : null,
    hours: formData.get('hours') ? Number(formData.get('hours')) : 0,
    courseType: String(formData.get('courseType') || 'initial').trim(),
    sortOrder: formData.get('sortOrder') ? Number(formData.get('sortOrder')) : 0,
  });

  revalidatePath('/admin/training');
  revalidatePath('/caregiver/training');
}

// Called by the caregiver from their own training page — the caregiver id
// comes from the session, never from the form, so one caregiver can't
// mark another's training complete.
export async function markCourseCompleteAction(courseId) {
  const session = await requirePermission('caregiver.training.complete');
  if (!session.caregiverId) return;

  await db.markCourseComplete(session.organizationId, session.caregiverId, courseId);

  revalidatePath('/caregiver/training');
  revalidatePath(`/admin/caregivers/${session.caregiverId}`);
  revalidatePath('/admin/training');
  revalidatePath('/admin/caregivers');
}
