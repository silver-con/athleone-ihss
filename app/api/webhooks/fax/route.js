// Inbound faxes from the agency's fax provider.
//
//   POST https://<APP_BASE_URL>/api/webhooks/fax?org=<organization id>
//   Authorization: Bearer <secret from the Fax Inbox settings>
//   (&token=<secret> in the address also works for providers that can't set
//   headers, but addresses are written to request logs — prefer the header.)
//   Body: multipart/form-data with the fax as a file field (any name),
//         or the raw PDF/TIFF with Content-Type application/pdf / image/tiff.
//   Sender number, if the provider sends it, in a form field named
//   from / From / sender / caller_id / fax_from.
//
// Answers quickly (providers retry slow webhooks) and reads the fax right
// after responding. The secret is compared by hash in constant time.
import { after } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getOrganizationFaxSettings } from '@/lib/queries';
import { ingestDocument, processDocument } from '@/lib/intake';
import { MAX_BYTES } from '@/lib/docai';

const SENDER_FIELDS = ['from', 'From', 'sender', 'caller_id', 'callerId', 'fax_from', 'FaxFrom'];

// Reads the raw body but stops once it passes `limit` bytes (a request
// without Content-Length could otherwise be of any size).
async function readCapped(request, limit) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function sameHash(token, storedHash) {
  if (!token || !storedHash) return false;
  const a = Buffer.from(createHash('sha256').update(token).digest('hex'));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  const url = new URL(request.url);
  const org = url.searchParams.get('org');
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : url.searchParams.get('token');
  if (!org) return new Response('Missing org', { status: 400 });

  let settings = null;
  try {
    settings = await getOrganizationFaxSettings(org);
  } catch {
    settings = null;
  }
  if (!settings || !sameHash(token, settings.webhookTokenHash)) {
    console.warn('[fax-webhook] rejected: bad or missing secret');
    return new Response('Forbidden', { status: 403 });
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 1024 * 1024) return new Response('Too large', { status: 413 });

  let buffer = null;
  let fileName = null;
  let sender = null;
  const type = request.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data') || type.startsWith('application/x-www-form-urlencoded')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      return new Response('Could not read the form data', { status: 400 });
    }
    for (const [, v] of form.entries()) {
      if (!buffer && v && typeof v === 'object' && typeof v.arrayBuffer === 'function') {
        buffer = Buffer.from(await v.arrayBuffer());
        fileName = v.name || null;
      }
    }
    for (const k of SENDER_FIELDS) if (!sender && form.get(k)) sender = String(form.get(k)).slice(0, 40);
  } else {
    buffer = await readCapped(request, MAX_BYTES);
    if (buffer === null) return new Response('Too large', { status: 413 });
    sender = (request.headers.get('x-fax-from') || '').slice(0, 40) || null;
  }
  if (!buffer || !buffer.length) return new Response('No fax file in the request', { status: 400 });

  const r = await ingestDocument({ organizationId: org, buffer, fileName: fileName || `fax-${Date.now()}.pdf`, source: 'fax', sender });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  if (!r.duplicateOf) after(() => processDocument(org, r.id));
  return Response.json({ received: true, id: r.id, duplicate: Boolean(r.duplicateOf) });
}
