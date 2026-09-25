// DocuSign Connect listener — see lib/docusign-connect.js. The agency is
// named in the URL (?org=…) so the right HMAC secret can be picked; the
// signature, not the URL, is what's trusted.
import * as db from '@/lib/queries';
import { decryptSecret } from '@/lib/secrets';
import { isValidConnectSignature, signaturesFromHeaders, applyConnectEvent } from '@/lib/docusign-connect';

const MAX_BODY = 5 * 1024 * 1024; // Connect can include documents if misconfigured; refuse huge bodies

export async function POST(request) {
  const org = new URL(request.url).searchParams.get('org');
  if (!org) return new Response('Missing org', { status: 400 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413 });

  let credentials = null;
  try {
    credentials = await db.getDocusignCredentials(org);
  } catch {
    credentials = null;
  }
  let secret = null;
  try {
    secret = credentials?.connectHmacKeyEnc ? decryptSecret(credentials.connectHmacKeyEnc) : null;
  } catch {
    secret = null;
  }
  if (!secret || !isValidConnectSignature(secret, raw, signaturesFromHeaders(request.headers))) {
    console.warn('[docusign-connect] rejected event: missing/invalid HMAC signature');
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    // Signed but not JSON (Connect set to XML). Acknowledge so DocuSign
    // doesn't retry forever; the E-Signature page says to pick JSON.
    console.warn('[docusign-connect] signed event was not JSON — set Connect data format to JSON (SIM)');
    return new Response(null, { status: 200 });
  }
  const result = await applyConnectEvent(org, body);
  console.log(`[docusign-connect] ${result.status || 'event'} ${result.envelopeId || ''} packets=${result.packets} orientations=${result.orientations}`);
  return new Response(null, { status: 200 });
}
