// Google Cloud access tokens, without the Google SDK (same no-heavy-SDK
// approach as lib/docusign.js). Used by Document AI (lib/docai/google.js)
// and Cloud Storage (lib/storage.js).
//
// Where the identity comes from, in order:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON — a service-account key's JSON, pasted into
//      the environment (handy for Docker/DigitalOcean);
//   2. GOOGLE_APPLICATION_CREDENTIALS — a path to a key file, or to a gcloud
//      user-login file;
//   3. your own Google login on this computer, from
//      `gcloud auth application-default login` (no key file at all — works
//      when your organization blocks service-account keys);
//   4. none of those: the metadata server — how it works on Google Cloud Run
//      (the service's own identity is used).
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';
let cached = null; // { token, expiresAt, key }

// Where `gcloud auth application-default login` saves your login.
export function gcloudAdcPath(env = process.env) {
  if (env.CLOUDSDK_CONFIG) return path.join(/* turbopackIgnore: true */ env.CLOUDSDK_CONFIG, 'application_default_credentials.json');
  if (process.platform === 'win32' && env.APPDATA) return path.join(/* turbopackIgnore: true */ env.APPDATA, 'gcloud', 'application_default_credentials.json');
  return path.join(/* turbopackIgnore: true */ env.HOME || homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

// Returns { kind: 'service_account' | 'authorized_user', json, origin } or null (use the metadata server).
export function loadGoogleCredentials(env = process.env) {
  let raw = null;
  let origin = null;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    origin = 'GOOGLE_SERVICE_ACCOUNT_JSON';
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      raw = readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    } catch (err) {
      throw new Error(`Can't read GOOGLE_APPLICATION_CREDENTIALS (${env.GOOGLE_APPLICATION_CREDENTIALS}): ${err.message}`);
    }
    origin = 'GOOGLE_APPLICATION_CREDENTIALS';
  } else if (!env.K_SERVICE && env.GOOGLE_USE_GCLOUD_LOGIN !== 'false') {
    const adc = gcloudAdcPath(env);
    if (existsSync(adc)) {
      raw = readFileSync(adc, 'utf8');
      origin = 'gcloud login';
    }
  }
  if (!raw) return null;
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`The Google credentials (${origin}) are not valid JSON.`);
  }
  if (json.type === 'authorized_user') {
    if (!json.client_id || !json.client_secret || !json.refresh_token) throw new Error(`The Google login (${origin}) is incomplete — run: gcloud auth application-default login`);
    return { kind: 'authorized_user', json, origin };
  }
  if (!json.client_email || !json.private_key) throw new Error(`The Google service-account key (${origin}) is missing client_email or private_key.`);
  return { kind: 'service_account', json, origin };
}

// Kept for callers/tests that only care about service-account keys.
export function loadServiceAccount(env = process.env) {
  const c = loadGoogleCredentials(env);
  return c?.kind === 'service_account' ? c.json : null;
}

export function googleCredentialSource(env = process.env) {
  let c = null;
  try {
    c = loadGoogleCredentials(env);
  } catch {
    c = null;
  }
  if (c?.kind === 'authorized_user') return `your Google login (${c.origin})`;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) return 'service-account key (GOOGLE_SERVICE_ACCOUNT_JSON)';
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return 'service-account key file (GOOGLE_APPLICATION_CREDENTIALS)';
  return 'Google Cloud runtime identity (metadata server)';
}

async function tokenFromUserLogin(u, fetchImpl) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: u.client_id, client_secret: u.client_secret, refresh_token: u.refresh_token }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google sign-in with your gcloud login failed (HTTP ${res.status}) ${json.error_description || json.error || ''} — run: gcloud auth application-default login`.trim());
  }
  return { token: json.access_token, expiresIn: json.expires_in || 3600 };
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
      'No Google credentials. On your computer run: gcloud auth application-default login (or set GOOGLE_APPLICATION_CREDENTIALS to a key file). On Google Cloud Run this is automatic.'
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Google metadata server refused a token (HTTP ${res.status}).`);
  return { token: json.access_token, expiresIn: json.expires_in || 3600 };
}

export async function getGoogleAccessToken({ fetchImpl = fetch, env = process.env } = {}) {
  const c = loadGoogleCredentials(env);
  const key = !c ? 'metadata' : c.kind === 'service_account' ? c.json.client_email : `user:${c.json.client_id}:${c.json.refresh_token.slice(-8)}`;
  if (cached && cached.key === key && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const { token, expiresIn } = !c
    ? await tokenFromMetadata(fetchImpl)
    : c.kind === 'service_account'
      ? await tokenFromServiceAccount(c.json, fetchImpl)
      : await tokenFromUserLogin(c.json, fetchImpl);
  cached = { token, key, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

// Headers for a Google API call. With a personal login, Google also needs
// to know which project to bill ("quota project").
export async function getGoogleAuthHeaders({ fetchImpl = fetch, env = process.env } = {}) {
  const token = await getGoogleAccessToken({ fetchImpl, env });
  const headers = { Authorization: `Bearer ${token}` };
  const c = loadGoogleCredentials(env);
  if (c?.kind === 'authorized_user') {
    const project = env.GOOGLE_CLOUD_PROJECT || c.json.quota_project_id;
    if (project) headers['x-goog-user-project'] = project;
  }
  return headers;
}

export function clearGoogleTokenCache() {
  cached = null;
}
