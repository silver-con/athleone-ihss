// Google Cloud access tokens, without the Google SDK (same no-heavy-SDK
// approach as lib/docusign.js). Used by Document AI (lib/docai/google.js)
// and Cloud Storage (lib/storage.js).
//
// Where the identity comes from, in order:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON — the key file's JSON, pasted into the
//      environment (handy for Docker/DigitalOcean);
//   2. GOOGLE_APPLICATION_CREDENTIALS — a path to the key file (your Mac:
//      keep it in ~/PrivateKeys, never inside the project folder);
//   3. neither: the metadata server — how it works on Google Cloud Run, with
//      no key file at all (the service's own identity is used).
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';
let cached = null; // { token, expiresAt, key }

export function loadServiceAccount(env = process.env) {
  let raw = null;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    } catch (err) {
      throw new Error(`Can't read GOOGLE_APPLICATION_CREDENTIALS (${env.GOOGLE_APPLICATION_CREDENTIALS}): ${err.message}`);
    }
  }
  if (!raw) return null;
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('The Google service-account key is not valid JSON.');
  }
  if (!json.client_email || !json.private_key) throw new Error('The Google service-account key is missing client_email or private_key.');
  return json;
}

export function googleCredentialSource(env = process.env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) return 'service-account key (GOOGLE_SERVICE_ACCOUNT_JSON)';
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return 'service-account key file (GOOGLE_APPLICATION_CREDENTIALS)';
  return 'Google Cloud runtime identity (metadata server)';
}

async function tokenFromServiceAccount(sa, fetchImpl) {
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(createPrivateKey(sa.private_key));
  const res = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google sign-in with the service-account key failed (HTTP ${res.status}) ${json.error_description || json.error || ''}`.trim());
  }
  return { token: json.access_token, expiresIn: json.expires_in || 3600 };
}

async function tokenFromMetadata(fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${METADATA}/instance/service-accounts/default/token`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error(
      'No Google credentials: set GOOGLE_APPLICATION_CREDENTIALS to your service-account key file (local), or run on Google Cloud.'
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Google metadata server refused a token (HTTP ${res.status}).`);
  return { token: json.access_token, expiresIn: json.expires_in || 3600 };
}

export async function getGoogleAccessToken({ fetchImpl = fetch, env = process.env } = {}) {
  const sa = loadServiceAccount(env);
  const key = sa ? sa.client_email : 'metadata';
  if (cached && cached.key === key && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const { token, expiresIn } = sa ? await tokenFromServiceAccount(sa, fetchImpl) : await tokenFromMetadata(fetchImpl);
  cached = { token, key, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

export function clearGoogleTokenCache() {
  cached = null;
}
