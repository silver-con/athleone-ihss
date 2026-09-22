'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

const VALID_STATUSES = ['pending', 'ready', 'submitted', 'paid', 'denied'];

export async function updateBillingLineStatusAction(billingLineId, status) {
  const session = await requirePermission('admin.finance.manage');
  if (!VALID_STATUSES.includes(status)) return;
  await db.updateBillingLineStatus(session.organizationId, billingLineId, status);

  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_billing_line_status',
    entityType: 'billing_line',
    entityId: billingLineId,
    detail: `status -> ${status}`,
  });

  revalidatePath('/admin/finance');
}

export async function createBillingLineAction(formData) {
  const session = await requirePermission('admin.finance.manage');
  const clientId = String(formData.get('clientId') || '').trim();

  const billingLineId = await db.createBillingLine(session.organizationId, {
    clientId,
    serviceCode: String(formData.get('serviceCode') || '').trim(),
    units: Number(formData.get('units') || 0),
    serviceDate: String(formData.get('serviceDate') || '').trim(),
    status: 'pending',
    notes: String(formData.get('notes') || '').trim() || null,
  });

  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'create_billing_line',
    entityType: 'billing_line',
    entityId: billingLineId,
    detail: `manual line for client ${clientId}`,
  });

  revalidatePath('/admin/finance');
}
