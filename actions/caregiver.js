'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// Every action here re-checks that the visit/thread actually belongs to
// the signed-in caregiver — the UI only ever shows a caregiver their own
// data, but a Server Action is a public endpoint, so this is the real
// authorization boundary (see the Data Security note in Next's forms
// guide), not just a nicety.
//
// Deliberately NOT location-scoped, unlike actions/admin.js. Ownership by
// caregiverId is the correct check for a caregiver, and layering a
// location guard on top was a bug: a session is a login-time snapshot, so
// a caregiver moved to another location mid-day could not clock in until
// they signed out and back in — a field outage on an EVV product.

export async function clockInAction(visitId) {
  const session = await requirePermission('caregiver.visit.clock');
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.clockIn(session.organizationId, visitId);
  revalidatePath('/caregiver/schedule');
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function clockOutAction(visitId) {
  const session = await requirePermission('caregiver.visit.clock');
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.clockOut(session.organizationId, visitId);
  revalidatePath('/caregiver/schedule');
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function toggleVisitTaskAction(visitId, taskId) {
  const session = await requirePermission('caregiver.visit.tasks');
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.toggleVisitTask(session.organizationId, visitId, taskId);
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function sendMessageAction(formData) {
  const session = await requirePermission('caregiver.messages.send');
  const text = String(formData.get('text') || '');
  await db.sendCaregiverMessage(session.organizationId, session.caregiverId, session.name, text);
  revalidatePath('/caregiver/messages');
}
