'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function submitIntakeAction(prevState, formData) {
  const session = await requireSession(['COORDINATOR', 'ADMIN']);
  const referralId = String(formData.get('referralId') || '');
  if (!formData.get('consent')) {
    return { error: 'Consent is required before an intake can be submitted.' };
  }

  const fields = {};
  for (const key of [
    'clientName', 'dob', 'phone', 'language', 'address', 'cityStateZip',
    'payerName', 'memberId', 'authNumber', 'authHours', 'serviceType', 'effectiveDates',
    'ecName', 'ecRelationship', 'ecPhone', 'physicianName', 'physicianPhone',
  ]) {
    fields[key] = String(formData.get(key) || '');
  }
  fields.careNeeds = formData.getAll('careNeeds').map(String);

  let result;
  try {
    result = await db.submitIntake(session.organizationId, referralId, fields);
  } catch (err) {
    return { error: err.message || 'Could not submit intake.' };
  }

  revalidatePath('/referrals');
  revalidatePath('/clients');
  redirect(`/clients?toast=${encodeURIComponent(`Intake completed for ${result.clientName} — client added to your caseload.`)}`);
}
