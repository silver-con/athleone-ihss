'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// Turns the free-text "Purchased Tasks" line from a payer authorization
// (e.g. "BATHING, Dressing, Exercise, Grooming (Shaving, Oral care, Nail
// Care), Toileting") into a clean array — same comma-separated shape
// MCOs actually send, so office staff can paste it straight off a fax
// or portal screen rather than re-typing it into separate fields.
function parseTaskList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createAuthorizationAction(formData) {
  const session = await requirePermission('admin.carePlans.manage');
  const clientId = String(formData.get('clientId') || '').trim();

  await db.createServiceAuthorization(session.organizationId, {
    clientId,
    payer: String(formData.get('payer') || '').trim(),
    caseId: String(formData.get('caseId') || '').trim() || null,
    referenceNumber: String(formData.get('referenceNumber') || '').trim() || null,
    serviceCode: String(formData.get('serviceCode') || '').trim(),
    serviceDescription: String(formData.get('serviceDescription') || '').trim(),
    modifierCodes: String(formData.get('modifierCodes') || '').trim() || null,
    diagnosisCode: String(formData.get('diagnosisCode') || '').trim() || null,
    diagnosisDescription: String(formData.get('diagnosisDescription') || '').trim() || null,
    totalHoursPerWeek: formData.get('totalHoursPerWeek') ? Number(formData.get('totalHoursPerWeek')) : null,
    totalUnitsPerWeek: formData.get('totalUnitsPerWeek') ? Number(formData.get('totalUnitsPerWeek')) : null,
    unitMinutes: formData.get('unitMinutes') ? Number(formData.get('unitMinutes')) : 15,
    // Blank stays null rather than becoming 0 — see createServiceAuthorization.
    ratePerUnit: formData.get('ratePerUnit') ? Number(formData.get('ratePerUnit')) : null,
    frequency: String(formData.get('frequency') || 'Weekly').trim(),
    startDate: String(formData.get('startDate') || '').trim(),
    endDate: String(formData.get('endDate') || '').trim(),
    status: String(formData.get('status') || 'approved').trim(),
    purchasedTasks: parseTaskList(String(formData.get('purchasedTasks') || '')),
    notes: String(formData.get('notes') || '').trim() || null,
  });

  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  revalidatePath('/admin/finance');
  revalidatePath('/admin/clients');
  // The rate on this authorization is what turns this client's billing
  // lines into dollars on the franchise rollup, so that page is stale now.
  revalidatePath('/admin/locations');
}
