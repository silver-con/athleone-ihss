'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/actions/auth';
import * as db from '@/lib/queries';
import { encryptSecret } from '@/lib/secrets';
import {
  testConnection,
  createEnvelope,
  createRecipientView,
  getEnvelope,
  clearTokenCache,
} from '@/lib/docusign';
import { PACKET_BUILDERS, buildOrientationAcknowledgmentHtml } from '@/lib/esign-documents';

async function baseUrl() {
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Saving credentials keeps the existing private key if the field is left
// blank — same pattern as the EVV credentials form, since the key can't be
// read back once encrypted.
export async function saveDocusignCredentialsAction(prevState, formData) {
  const session = await requireSession(['ADMIN']);
  const existing = await db.getDocusignCredentials(session.organizationId);

  const integrationKey = String(formData.get('integrationKey') || '').trim();
  const apiUsername = String(formData.get('apiUsername') || '').trim();
  const accountId = String(formData.get('accountId') || '').trim();
  const privateKey = String(formData.get('privateKey') || '').trim();

  if (!integrationKey || !apiUsername || !accountId) {
    return { error: 'Integration key, API username, and account ID are all required.' };
  }
  if (!existing && !privateKey) {
    return { error: 'A private key is required the first time.' };
  }

  try {
    await db.upsertDocusignCredentials(session.organizationId, {
      integrationKey,
      apiUsername,
      accountId,
      privateKeyEnc: privateKey ? encryptSecret(privateKey) : existing.privateKeyEnc,
      environment: String(formData.get('environment') || 'demo').trim(),
      status: existing?.status && existing.status !== 'not_started' ? existing.status : 'testing',
      // baa_on_file is a manual attestation, set directly from the
      // checkbox on every save — a plain checked/unchecked boolean, not
      // derived from anything else in the system.
      baaOnFile: formData.has('baaOnFile'),
    });
  } catch (err) {
    return { error: err.message || 'Could not save the credentials.' };
  }

  clearTokenCache(session.organizationId);
  revalidatePath('/admin/esign');
  return { saved: true, error: null };
}

export async function testDocusignConnectionAction() {
  const session = await requireSession(['ADMIN']);
  const credentials = await db.getDocusignCredentials(session.organizationId);
  if (!credentials) return { ok: false, error: 'No credentials saved yet.' };

  const result = await testConnection(credentials);
  if (result.ok) {
    await db.setDocusignCredentialStatus(session.organizationId, 'connected', { touchSuccess: true });
  }
  revalidatePath('/admin/esign');
  return result;
}

// Caregiver-facing: builds the 3-document onboarding packet envelope and
// sends the caregiver's own browser into DocuSign's embedded signing view.
// DocuSign redirects back to the route handler below when they're done.
export async function startPacketSigningAction() {
  const session = await requireSession(['CAREGIVER']);
  if (!session.caregiverId) redirect('/caregiver/onboarding');

  const credentials = await db.getDocusignCredentials(session.organizationId);
  if (!credentials || credentials.status !== 'connected') {
    // No DocuSign connection configured yet — the caregiver's onboarding
    // page falls back to "the office will send these to you" copy in this
    // case, so this action shouldn't normally be reachable, but guard it
    // anyway rather than trusting the UI.
    redirect('/caregiver/onboarding');
  }

  const caregiver = await db.getCaregiver(session.organizationId, session.caregiverId);
  const organization = await db.getOrganization(session.organizationId);
  if (!caregiver?.email) redirect('/caregiver/onboarding');

  const documents = Object.entries(PACKET_BUILDERS).map(([, { name, build }]) => ({
    name,
    html: build({ organizationName: organization?.name || 'the agency', caregiverName: caregiver.name }),
  }));

  let envelopeId;
  try {
    const envelope = await createEnvelope(credentials, {
      emailSubject: `${organization?.name || 'Hearth'} — onboarding documents to sign`,
      documents,
      signerEmail: caregiver.email,
      signerName: caregiver.name,
      embedded: true,
    });
    envelopeId = envelope.envelopeId;
    await db.markPacketSent(session.organizationId, session.caregiverId, envelopeId);

    const returnUrl = `${await baseUrl()}/caregiver/onboarding/sign/return?envelopeId=${encodeURIComponent(envelopeId)}`;
    const signingUrl = await createRecipientView(credentials, envelopeId, {
      signerEmail: caregiver.email,
      signerName: caregiver.name,
      returnUrl,
    });
    redirect(signingUrl);
  } catch (err) {
    if (err?.digest?.startsWith?.('NEXT_REDIRECT')) throw err; // let redirect() through
    // Fall back to the checklist with nothing changed visually — the
    // documents stay 'sent' from markPacketSent above if that step
    // succeeded, which is fine: a retry just reuses/relaunches signing.
    console.error('[docusign] startPacketSigningAction failed:', err);
    const detail = encodeURIComponent(String(err?.message || err).slice(0, 300));
    redirect(`/caregiver/onboarding?esignError=1&esignDetail=${detail}`);
  }
}

// Admin-initiated: sends the Attendant Orientation acknowledgment to the
// caregiver's email for remote (non-embedded) signing. Hard-blocked unless
// baa_on_file is true — this document carries client PHI (name, HHSC
// individual number), and DocuSign only covers that under a signed BAA.
export async function startOrientationSigningAction(orientationId, formData) {
  const session = await requireSession(['ADMIN', 'COORDINATOR']);

  const credentials = await db.getDocusignCredentials(session.organizationId);
  if (!credentials || credentials.status !== 'connected') {
    return { error: 'Connect DocuSign on the E-Signature settings page first.' };
  }
  if (!credentials.baaOnFile) {
    return {
      error:
        'This document contains client information and cannot be sent through DocuSign until a signed BAA is on file for this account — see the E-Signature settings page.',
    };
  }

  const orientation = await db.getOrientation(session.organizationId, orientationId);
  if (!orientation) return { error: 'Orientation not found.' };

  const [caregiver, client, organization] = await Promise.all([
    db.getCaregiver(session.organizationId, orientation.caregiverId),
    db.getClient(session.organizationId, orientation.clientId),
    db.getOrganization(session.organizationId),
  ]);
  if (!caregiver?.email) return { error: 'This caregiver has no email on file to send the document to.' };

  const method = String(formData.get('method') || '').trim() || null;
  const orientedOn = String(formData.get('orientedOn') || '').trim() || null;
  const agencyRepName = String(formData.get('agencyRepName') || '').trim() || null;
  const notes = String(formData.get('notes') || '').trim() || null;

  const html = buildOrientationAcknowledgmentHtml({
    organizationName: organization?.name,
    caregiverName: caregiver.name,
    clientName: client?.name,
    hhscIndividualNumber: client?.hhscIndividualNumber,
    orientationType: orientation.orientationType,
    method,
    orientedOn,
    agencyRepName,
  });

  try {
    const envelope = await createEnvelope(credentials, {
      emailSubject: `${organization?.name || 'Hearth'} — Attendant Orientation acknowledgment`,
      documents: [{ name: 'Attendant Orientation Acknowledgment', html }],
      signerEmail: caregiver.email,
      signerName: caregiver.name,
      embedded: false,
    });
    await db.sendOrientationForSignature(session.organizationId, orientationId, {
      method,
      orientedOn,
      agencyRepName,
      notes,
      envelopeId: envelope.envelopeId,
    });
  } catch (err) {
    return { error: err.message || 'Could not send the document through DocuSign.' };
  }

  revalidatePath(`/admin/orientations/${orientationId}`);
  return { sent: true };
}

// Admin manually checks whether a sent orientation envelope has come back
// signed — polling rather than a webhook, same tradeoff made for EVV sync
// (no publicly reachable endpoint assumed for a dev-environment install).
export async function checkOrientationSigningStatusAction(orientationId) {
  const session = await requireSession(['ADMIN', 'COORDINATOR']);
  const orientation = await db.getOrientation(session.organizationId, orientationId);
  if (!orientation?.envelopeId) return { error: 'No envelope on file for this orientation.' };

  const credentials = await db.getDocusignCredentials(session.organizationId);
  if (!credentials) return { error: 'No DocuSign connection configured.' };

  try {
    const { status } = await getEnvelope(credentials, orientation.envelopeId);
    if (status === 'completed') {
      await db.confirmOrientationSigned(session.organizationId, orientationId);
      revalidatePath(`/admin/orientations/${orientationId}`);
      return { status: 'completed' };
    }
    return { status };
  } catch (err) {
    return { error: err.message || 'Could not check the envelope status.' };
  }
}
