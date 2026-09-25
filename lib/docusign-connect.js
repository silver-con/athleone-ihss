// DocuSign Connect: DocuSign POSTs envelope status changes to
// /api/webhooks/docusign?org=<organizationId>, so a signed onboarding packet
// or orientation updates in Hearth on its own — no waiting for the caregiver
// to land back on the return page, no "Check status" button.
//
// Authenticity: each agency configures an HMAC secret in its DocuSign
// Connect settings and pastes the same secret on Hearth's E-Signature page.
// DocuSign sends base64(HMAC-SHA256(secret, raw body)) in
// X-DocuSign-Signature-1 (…-2, …-3 while keys rotate). Anything unsigned or
// wrongly signed is refused before its body is looked at.
// https://developers.docusign.com/platform/webhooks/connect/hmac/
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as db from '@/lib/queries';

export function connectSignature(secret, rawBody) {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

export function signaturesFromHeaders(headers) {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const v = headers.get(`x-docusign-signature-${i}`);
    if (v) out.push(v);
  }
  return out;
}

export function isValidConnectSignature(secret, rawBody, signatures) {
  if (!secret || !signatures?.length) return false;
  const expected = Buffer.from(connectSignature(secret, rawBody));
  return signatures.some((sig) => {
    const given = Buffer.from(String(sig));
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Pulls { envelopeId, status } out of either Connect JSON format:
//   JSON SIM (current):  { event: 'envelope-completed', data: { envelopeId, envelopeSummary: { status } } }
//   legacy JSON:         { envelopeId, status }
export function parseConnectEvent(body) {
  const envelopeId = body?.data?.envelopeId || body?.envelopeId || body?.data?.envelopeSummary?.envelopeId || null;
  let status = body?.data?.envelopeSummary?.status || body?.status || null;
  if (!status && typeof body?.event === 'string' && body.event.startsWith('envelope-')) status = body.event.slice('envelope-'.length);
  return { envelopeId, status: status ? String(status).toLowerCase() : null, event: body?.event || null };
}

// Applies a verified event. Returns what it changed.
//
// `confirmCompleted(envelopeId)` asks DocuSign's API whether the envelope
// really is completed before anything is marked signed. The HMAC proves the
// event came from someone holding the agency's secret — but the agency's
// own admin holds it too, and a signature record is compliance evidence, so
// the status is confirmed at the source (2026-09-25 review fix).
export async function applyConnectEvent(organizationId, body, { confirmCompleted } = {}) {
  const { envelopeId, status } = parseConnectEvent(body);
  await db.touchDocusignConnectEvent(organizationId);
  if (!envelopeId || status !== 'completed') return { envelopeId, status, packets: 0, orientations: 0 };
  const targets = await db.findDocusignEnvelopeTargets(organizationId, envelopeId);
  if (!targets.packetCaregiverIds.length && !targets.orientationIds.length) {
    return { envelopeId, status, packets: 0, orientations: 0 };
  }
  if (!confirmCompleted || !(await confirmCompleted(envelopeId))) {
    return { envelopeId, status, packets: 0, orientations: 0, unconfirmed: true };
  }
  for (const caregiverId of targets.packetCaregiverIds) await db.markPacketSigned(organizationId, caregiverId, envelopeId);
  for (const orientationId of targets.orientationIds) await db.confirmOrientationSigned(organizationId, orientationId);
  return { envelopeId, status, packets: targets.packetCaregiverIds.length, orientations: targets.orientationIds.length };
}
