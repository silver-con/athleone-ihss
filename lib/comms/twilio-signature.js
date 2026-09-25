// Verifies that a webhook request really came from Twilio.
// https://www.twilio.com/docs/usage/security#validating-requests
//
// Twilio signs: the full public URL it called + every POST parameter
// (sorted by name, name immediately followed by value), HMAC-SHA1 with the
// account's Auth Token, base64. We rebuild the URL from APP_BASE_URL rather
// than the Host header, because behind DigitalOcean's load balancer / Caddy
// the app sees an internal address, not the one Twilio used.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function isValidTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Reads a Twilio webhook (application/x-www-form-urlencoded) into a plain
// object and checks its signature. Returns { ok, params, reason }.
export async function readTwilioWebhook(request, { authToken, baseUrl }) {
  const form = await request.formData();
  const params = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  if (!authToken) return { ok: false, params, reason: 'twilio_not_configured' };
  if (!baseUrl) return { ok: false, params, reason: 'app_base_url_not_set' };
  const u = new URL(request.url);
  const publicUrl = `${baseUrl}${u.pathname}${u.search}`;
  const ok = isValidTwilioSignature(authToken, publicUrl, params, request.headers.get('x-twilio-signature'));
  return { ok, params, reason: ok ? null : 'bad_signature' };
}
