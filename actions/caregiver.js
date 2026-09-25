'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { isVisitLocation } from '@/lib/geo';
import { notifyOfficeOfCaregiverMessage } from '@/lib/messaging';

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

// Client-supplied geolocation is untrusted input, same as any other form
// field — narrow it to finite numbers in a plausible range before it ever
// reaches a SQL parameter, and drop anything else rather than throwing (a
// caregiver who denied location access, or whose browser sent nothing,
// should still be able to clock in/out).
function sanitizeGeo(geo) {
  if (!geo || typeof geo !== 'object') return null;
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const accuracy = Number(geo.accuracy);
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null };
}

// `where`: the caregiver's pick of lib/geo.js VISIT_LOCATIONS (untrusted —
// anything unrecognised falls back to the client's home).
export async function clockInAction(visitId, geo = null, where = 'member_home') {
  const session = await requirePermission('caregiver.visit.clock');
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  // Only an ACTIVE caregiver may start a visit. On-leave, onboarding and
  // applicant caregivers can still sign in (messages, onboarding tasks),
  // but must not create EVV records. Clock-OUT is deliberately not gated:
  // a caregiver put on leave mid-visit still needs to close that visit.
  const caregiver = await db.getCaregiver(session.organizationId, session.caregiverId);
  if (!caregiver || caregiver.status !== 'active') {
    return { error: 'Your caregiver status is not active, so you can\'t start a visit. Contact your agency office.' };
  }
  await db.clockIn(session.organizationId, visitId, null, sanitizeGeo(geo), isVisitLocation(where) ? where : 'member_home');
  revalidatePath('/caregiver/schedule');
  revalidatePath(`/caregiver/visit/${visitId}`);
}

export async function clockOutAction(visitId, geo = null, where = 'member_home') {
  const session = await requirePermission('caregiver.visit.clock');
  const visit = await db.getVisit(session.organizationId, visitId);
  if (!visit || visit.caregiverId !== session.caregiverId) return;
  await db.clockOut(session.organizationId, visitId, null, sanitizeGeo(geo), isVisitLocation(where) ? where : 'member_home');
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
  const id = await db.sendCaregiverMessage(session.organizationId, session.caregiverId, session.name, text);
  if (id) await notifyOfficeOfCaregiverMessage(session.organizationId, session.caregiverId, text);
  revalidatePath('/caregiver/messages');
}
