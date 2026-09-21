'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// Texas requires the DPS criminal history, EMR and NAR checks before hire
// and annually thereafter, so a recorded check defaults its next due date
// to one year out unless the office overrides it.
function oneYearAfter(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export async function recordCheckAction(formData) {
  const session = await requirePermission('admin.caregiverHr.manage');
  const caregiverId = String(formData.get('caregiverId') || '').trim();
  const completedOn = String(formData.get('completedOn') || '').trim();
  if (!caregiverId || !completedOn) return;

  const nextDueOn = String(formData.get('nextDueOn') || '').trim() || oneYearAfter(completedOn);

  await db.recordCaregiverCheck(session.organizationId, caregiverId, {
    checkType: String(formData.get('checkType') || '').trim(),
    completedOn,
    nextDueOn,
    performedBy: String(formData.get('performedBy') || '').trim() || session.name,
    result: String(formData.get('result') || 'clear').trim(),
    notes: String(formData.get('notes') || '').trim() || null,
  });

  revalidatePath(`/admin/caregivers/${caregiverId}`);
  revalidatePath('/admin/caregivers');
}

export async function updateDocumentAction(formData) {
  const session = await requirePermission('admin.caregiverHr.manage');
  const caregiverId = String(formData.get('caregiverId') || '').trim();
  const docType = String(formData.get('docType') || '').trim();
  if (!caregiverId || !docType) return;

  await db.upsertCaregiverDocument(session.organizationId, caregiverId, {
    docType,
    status: String(formData.get('status') || 'not_started').trim(),
    completedOn: String(formData.get('completedOn') || '').trim() || null,
    expiresOn: String(formData.get('expiresOn') || '').trim() || null,
    notes: String(formData.get('notes') || '').trim() || null,
  });

  revalidatePath(`/admin/caregivers/${caregiverId}`);
  revalidatePath('/admin/caregivers');
}

export async function setCaregiverStatusAction(caregiverId, status) {
  const session = await requirePermission('admin.caregiverHr.statusOverride');
  await db.setCaregiverStatus(session.organizationId, caregiverId, status);
  revalidatePath(`/admin/caregivers/${caregiverId}`);
  revalidatePath('/admin/caregivers');
  revalidatePath('/admin/schedule');
}
