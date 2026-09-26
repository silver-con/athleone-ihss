'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function createReferralAction(prevState, formData) {
  const session = await requirePermission('shared.referrals.manage');

  const fields = {};
  for (const key of [
    'payer', 'clientName', 'dob', 'service', 'authHours', 'authNumber', 'diagnosis', 'receivedDate',
  ]) {
    fields[key] = String(formData.get(key) || '');
  }

  let referralId;
  try {
    referralId = await db.createReferral(session.organizationId, fields);
  } catch (err) {
    return { error: err.message || 'Could not create referral.' };
  }

  revalidatePath('/referrals');
  redirect(`/referrals/${referralId}`);
}

export async function submitIntakeAction(prevState, formData) {
  const session = await requirePermission('shared.referrals.manage');
  const referralId = String(formData.get('referralId') || '');
  if (!formData.get('consent')) {
    return { error: 'Consent is required before an intake can be submitted.' };
  }

  const fields = {};
  for (const key of [
    'clientName', 'dob', 'phone', 'language', 'address', 'city', 'state', 'zip',
    'payerName', 'memberId', 'authNumber', 'authHours', 'serviceType', 'effectiveDates',
    'ecName', 'ecRelationship', 'ecPhone', 'physicianName', 'physicianPhone',
  ]) {
    fields[key] = String(formData.get(key) || '');
  }
  fields.careNeeds = formData.getAll('careNeeds').map(String);
  // Same rule as hiring: a location admin's intake lands in their own
  // location regardless of the form, and every intake needs a location.
  fields.locationId = session.locationId || String(formData.get('locationId') || '').trim() || null;
  if (!fields.locationId) {
    return { error: 'Pick the location this client belongs to before submitting the intake.' };
  }

  let result;
  try {
    result = await db.submitIntake(session.organizationId, referralId, fields);
  } catch (err) {
    return { error: err.message || 'Could not submit intake.' };
  }

  if (result.authorizationId) {
    await db.logAuditEvent(session.organizationId, {
      actorUserId: session.userId,
      actorName: session.name,
      actorRole: session.role,
      locationId: session.locationId,
      action: 'create_service_authorization',
      entityType: 'service_authorization',
      entityId: result.authorizationId,
      detail: `created from the approved fax at intake (status ${result.authorizationStatus}) for client ${result.clientId}`,
    });
  }

  revalidatePath('/referrals');
  revalidatePath('/clients');
  revalidatePath('/admin/finance');
  const carePlan = result.authorizationId
    ? ` Care plan created from the fax${result.authorizationStatus === 'approved' ? '' : ` (${result.authorizationStatus} — confirm it)`}.`
    : '';
  redirect(`/clients?toast=${encodeURIComponent(`Intake completed for ${result.clientName} — client added to your caseload.${carePlan}`)}`);
}
