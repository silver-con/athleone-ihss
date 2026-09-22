'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { encryptSecret } from '@/lib/secrets';
import { getEvvAdapter } from '@/lib/evv-adapters';
import { runSyncCycle } from '@/lib/evv-sync';

// Saving credentials keeps the existing secret if the field is left blank,
// so an admin can correct the base URL or provider IDs without re-entering
// the client secret (which they can't read back — it's encrypted).
export async function saveEvvCredentialsAction(prevState, formData) {
  const session = await requirePermission('admin.evv.credentials.manage');
  const existing = await db.getEvvCredentials(session.organizationId);

  const clientId = String(formData.get('clientId') || '').trim();
  const clientSecret = String(formData.get('clientSecret') || '').trim();

  if (!existing && (!clientId || !clientSecret)) {
    return { error: 'A client ID and client secret are required the first time.' };
  }

  try {
    await db.upsertEvvCredentials(session.organizationId, {
      apiBaseUrl: String(formData.get('apiBaseUrl') || '').trim(),
      apiVersion: String(formData.get('apiVersion') || '1').trim(),
      clientIdEnc: clientId ? encryptSecret(clientId) : existing.clientIdEnc,
      clientSecretEnc: clientSecret ? encryptSecret(clientSecret) : existing.clientSecretEnc,
      scope: String(formData.get('scope') || '').trim() || null,
      providerTaxId: String(formData.get('providerTaxId') || '').trim() || null,
      officeQualifier: String(formData.get('officeQualifier') || 'NPI').trim(),
      officeIdentifier: String(formData.get('officeIdentifier') || '').trim() || null,
      payerId: String(formData.get('payerId') || '').trim() || null,
      environment: String(formData.get('environment') || 'sandbox').trim(),
      aggregator: existing?.aggregator || 'hhaexchange',
      status: existing?.status && existing.status !== 'not_started' ? existing.status : 'testing',
    });
  } catch (err) {
    return { error: err.message || 'Could not save the credentials.' };
  }

  getEvvAdapter(existing?.aggregator || 'hhaexchange').clearTokenCache(session.organizationId);

  // Never log the actual client id/secret values — just that credentials
  // were touched and which non-secret fields this save carried.
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: existing ? 'update_evv_credentials' : 'create_evv_credentials',
    entityType: 'evv_credentials',
    entityId: session.organizationId,
    detail: `${clientId ? 'client id changed; ' : ''}${clientSecret ? 'client secret changed; ' : ''}environment ${String(formData.get('environment') || 'sandbox').trim()}`,
  });

  revalidatePath('/admin/evv/sync');
  return { saved: true, error: null };
}

export async function testEvvConnectionAction() {
  const session = await requirePermission('admin.evv.credentials.manage');
  const credentials = await db.getEvvCredentials(session.organizationId);
  if (!credentials) return { ok: false, error: 'No credentials saved yet.' };

  const result = await getEvvAdapter(credentials.aggregator || 'hhaexchange').testConnection(credentials);
  if (result.ok) {
    await db.setEvvCredentialStatus(session.organizationId, credentials.status, {
      touchSuccess: true,
    });
  }
  revalidatePath('/admin/evv/sync');
  return result;
}

// Manual trigger for the send-then-poll cycle. In production this same
// function is what a scheduled job would call; the button exists so office
// staff are never stuck waiting on a scheduler.
export async function runEvvSyncAction() {
  const session = await requirePermission('admin.evv.sync.manage');
  const result = await runSyncCycle(session.organizationId);
  revalidatePath('/admin/evv/sync');
  revalidatePath('/admin/evv');
  return result;
}

export async function retrySyncRowAction(rowId) {
  const session = await requirePermission('admin.evv.sync.manage');
  await db.retrySyncRow(session.organizationId, rowId);
  revalidatePath('/admin/evv/sync');
}
