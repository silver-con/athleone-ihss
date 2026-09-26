'use server';

// Fax inbox actions. Uploads go through app/(dashboard)/inbox/upload/route.js
// instead (files can be up to 20 MB; Server Actions are capped at 1 MB).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { ingestDocument, processDocument } from '@/lib/intake';
import { FIELDS } from '@/lib/docai/fields';
import { validateFields, hasBlockingIssues } from '@/lib/docai/validate';
import { SAMPLE_FAXES, sampleFaxesEnabled } from '@/lib/docai/samples';

async function audit(session, action, entityId, detail) {
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action,
    entityType: 'incoming_document',
    entityId,
    detail,
  });
}

export async function loadSampleFaxAction(sampleKey) {
  const session = await requirePermission('shared.inbox.manage');
  if (!sampleFaxesEnabled()) {
    return { error: 'Sample faxes are switched off on this server.' };
  }
  const sample = Object.hasOwn(SAMPLE_FAXES, String(sampleKey)) ? SAMPLE_FAXES[sampleKey] : null;
  if (!sample) return { error: 'Unknown sample.' };
  const buffer = await readFile(path.join(process.cwd(), 'scripts', 'sample-faxes', sample.file));
  // A sample can be loaded again and again: a trailing PDF comment makes
  // each copy's hash unique, so it isn't treated as a resent duplicate.
  const unique = Buffer.concat([buffer, Buffer.from(`\n%sample-${randomBytes(4).toString('hex')}\n`)]);
  const r = await ingestDocument({
    organizationId: session.organizationId,
    buffer: unique,
    fileName: sample.file,
    source: 'sample',
    sender: sample.sender,
    userId: session.userId,
  });
  if (!r.ok) return { error: r.error };
  await processDocument(session.organizationId, r.id);
  await audit(session, 'fax_sample_loaded', r.id, sample.file);
  revalidatePath('/inbox');
  redirect(`/inbox/${r.id}`);
}

export async function retryDocumentAction(documentId) {
  const session = await requirePermission('shared.inbox.manage');
  const r = await processDocument(session.organizationId, String(documentId));
  revalidatePath(`/inbox/${documentId}`);
  revalidatePath('/inbox');
  return r.ok ? { ok: true } : { error: r.error };
}

// Reviewer's final values -> referral. The values come from the form (the
// reviewer may have corrected them), re-validated here; the extracted
// confidence doesn't block approval, errors do.
export async function approveDocumentAction(documentId, prevState, formData) {
  const session = await requirePermission('shared.inbox.manage');
  const fields = {};
  const asFields = {};
  for (const f of FIELDS) {
    const v = String(formData.get(f.key) || '').trim().slice(0, f.key === 'approvedTasks' ? 1000 : f.key === 'diagnosis' || f.key === 'address' || f.key === 'service' ? 300 : 120);
    fields[f.key] = v;
    asFields[f.key] = { value: v, confidence: 1, source: 'reviewer' };
  }
  const issues = validateFields(asFields, { checkConfidence: false });
  if (hasBlockingIssues(issues)) {
    const first = Object.values(issues).flat().find((i) => i.level === 'error');
    return { error: `Fix the highlighted fields first: ${first.message}`, issues };
  }
  let referralId;
  try {
    referralId = await db.approveIncomingDocument(session.organizationId, String(documentId), {
      fields,
      reviewer: { userId: session.userId, name: session.name },
    });
  } catch (err) {
    // Only our own, written-for-people messages go back to the browser.
    if (err?.userFacing) return { error: err.message };
    console.error('[intake] approve failed:', err);
    return { error: 'Could not approve this document. Refresh the page and try again.' };
  }
  await audit(session, 'fax_approved', String(documentId), `referral ${referralId} created for ${fields.clientName}`);
  revalidatePath('/inbox');
  revalidatePath('/referrals');
  redirect(`/referrals/${referralId}`);
}

export async function rejectDocumentAction(documentId, prevState, formData) {
  const session = await requirePermission('shared.inbox.manage');
  const reason = String(formData.get('reason') || '').trim();
  if (!reason) return { error: 'Say why (e.g. "not a referral", "duplicate", "wrong agency").' };
  try {
    await db.rejectIncomingDocument(session.organizationId, String(documentId), { reason, reviewer: { userId: session.userId, name: session.name } });
  } catch (err) {
    if (err?.userFacing) return { error: err.message };
    console.error('[intake] reject failed:', err);
    return { error: 'Could not reject this document. Refresh the page and try again.' };
  }
  await audit(session, 'fax_rejected', String(documentId), reason.slice(0, 200));
  revalidatePath('/inbox');
  redirect('/inbox');
}

// The secret the fax provider sends with each inbound fax. Shown once.
export async function generateFaxWebhookTokenAction() {
  const session = await requirePermission('admin.fax.manage');
  const token = randomBytes(24).toString('base64url');
  await db.setOrganizationFaxSettings(session.organizationId, { webhookTokenHash: createHash('sha256').update(token).digest('hex') });
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'fax_webhook_token_generated',
    entityType: 'organization',
    entityId: session.organizationId,
    detail: 'new fax webhook secret generated (any previous one stops working)',
  });
  revalidatePath('/inbox');
  return { token };
}

export async function saveFaxNumberAction(prevState, formData) {
  const session = await requirePermission('admin.fax.manage');
  await db.setOrganizationFaxSettings(session.organizationId, { faxNumber: String(formData.get('faxNumber') || '') });
  revalidatePath('/inbox');
  return { success: 'Saved.' };
}
