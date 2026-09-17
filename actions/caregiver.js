'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/actions/auth';
import * as db from '@/lib/queries';

// Every action here re-checks that the visit/thread actually belongs to
// the signed-in caregiver — the UI only ever shows a caregiver their own
// data, but a Server Action is a public endpoint, so this is the real
// authorization boundary (see the Data Security note in Next's forms
// guide), not just a nicety.

export async function clockInAction(visitId) {
  const session = await requireSession(['CAREGIVER']);
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.clockIn(session.organizationId, visitId);
  revalidatePath('/caregiver/schedule');
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function clockOutAction(visitId) {
  const session = await requireSession(['CAREGIVER']);
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.clockOut(session.organizationId, visitId);
  revalidatePath('/caregiver/schedule');
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function toggleVisitTaskAction(visitId, taskId) {
  const session = await requireSession(['CAREGIVER']);
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.toggleVisitTask(session.organizationId, visitId, taskId);
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function sendMessageAction(formData) {
  const session = await requireSession(['CAREGIVER']);
  const text = String(formData.get('text') || '');
  await db.sendCaregiverMessage(session.organizationId, session.caregiverId, session.name, text);
  revalidatePath('/caregiver/messages');
}
