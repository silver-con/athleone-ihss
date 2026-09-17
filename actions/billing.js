'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/actions/auth';
import * as db from '@/lib/queries';

const VALID_STATUSES = ['pending', 'ready', 'submitted', 'paid', 'denied'];

export async function updateBillingLineStatusAction(billingLineId, status) {
  const session = await requireSession(['ADMIN', 'COORDINATOR']);
  if (!VALID_STATUSES.includes(status)) return;
  await db.updateBillingLineStatus(session.organizationId, billingLineId, status);
  revalidatePath('/admin/finance');
}

export async function createBillingLineAction(formData) {
  const session = await requireSession(['ADMIN', 'COORDINATOR']);

  await db.createBillingLine(session.organizationId, {
    clientId: String(formData.get('clientId') || '').trim(),
    serviceCode: String(formData.get('serviceCode') || '').trim(),
    units: Number(formData.get('units') || 0),
    serviceDate: String(formData.get('serviceDate') || '').trim(),
    status: 'pending',
    notes: String(formData.get('notes') || '').trim() || null,
  });

  revalidatePath('/admin/finance');
}
