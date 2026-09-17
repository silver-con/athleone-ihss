// HHAeXchange EVV Data Aggregator client.
//
// Every call is tenant-scoped: an agency authenticates with its own OAuth2
// client, tied to its own Medicaid provider identity. There is deliberately
// no global/shared credential path in this module — a bug that let one
// tenant's visits go out under another tenant's provider ID would be both a
// compliance and a HIPAA problem.
//
// The API is asynchronous: a submission returns a transaction id, and the
// real outcome is learned by polling the transaction status endpoint. This
// module does the transport only; the queue in lib/evv-sync.js decides what
// to send and when to retry.
//
// Contract (per the vendor's published API documentation):
//   POST   /identity/connect/token                       OAuth2 client credentials
//   POST   /api/v{version}/caregivers                    one caregiver per call
//   POST   /api/v{version}/visits                        batch of visits
//   PUT    /api/v{version}/visits/{evvmsId}
//   DELETE /api/v{version}/visits/{evvmsId}
//   GET    /api/v{version}/visits/transactions/{txId}    max 5 calls/sec
import { decryptSecret } from '@/lib/secrets';

// Access tokens live 30 minutes and are meant to be reused until they
// expire. Cached per tenant, in memory only — never persisted.
const tokenCache = new Map();
const TOKEN_SAFETY_WINDOW_MS = 60_000;

class EvvApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'EvvApiError';
    this.status = status;
    this.body = body;
  }
}

function baseUrl(credentials) {
  return String(credentials.apiBaseUrl || '').replace(/\/+$/, '');
}

function apiPath(credentials, path) {
  return `${baseUrl(credentials)}/api/v${credentials.apiVersion || '1'}${path}`;
}

async function getAccessToken(credentials) {
  const cached = tokenCache.get(credentials.organizationId);
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: decryptSecret(credentials.clientIdEnc),
    client_secret: decryptSecret(credentials.clientSecretEnc),
  });
  if (credentials.scope) body.set('scope', credentials.scope);

  const res = await fetch(`${baseUrl(credentials)}/identity/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    // Never include the request body in the error — it carries the secret.
    throw new EvvApiError(`Authentication failed (HTTP ${res.status})`, { status: res.status });
  }

  const json = await res.json();
  if (!json.access_token) throw new EvvApiError('Authentication response contained no access token.');

  tokenCache.set(credentials.organizationId, {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 1800) * 1000,
  });
  return json.access_token;
}

export function clearTokenCache(organizationId) {
  if (organizationId) tokenCache.delete(organizationId);
  else tokenCache.clear();
}

async function request(credentials, method, path, payload) {
  const token = await getAccessToken(credentials);
  const res = await fetch(apiPath(credentials, path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    // A 401 usually means the cached token went stale early; drop it so the
    // next attempt re-authenticates rather than failing repeatedly.
    if (res.status === 401) clearTokenCache(credentials.organizationId);
    const detail = json?.message || json?.error || text?.slice(0, 300) || '';
    throw new EvvApiError(`${method} ${path} failed (HTTP ${res.status}) ${detail}`.trim(), {
      status: res.status,
      body: json,
    });
  }

  return json;
}

export async function upsertCaregiver(credentials, caregiverPayload) {
  // The API accepts one caregiver per call.
  const res = await request(credentials, 'POST', '/caregivers', caregiverPayload);
  return { transactionId: res?.transactionId || res?.TransactionID || null, raw: res };
}

export async function submitVisits(credentials, visitPayloads) {
  const res = await request(credentials, 'POST', '/visits', visitPayloads);
  return { transactionId: res?.transactionId || res?.TransactionID || null, raw: res };
}

export async function updateVisit(credentials, evvmsId, visitPayload) {
  const res = await request(credentials, 'PUT', `/visits/${encodeURIComponent(evvmsId)}`, visitPayload);
  return { transactionId: res?.transactionId || res?.TransactionID || null, raw: res };
}

export async function deleteVisit(credentials, evvmsId) {
  const res = await request(credentials, 'DELETE', `/visits/${encodeURIComponent(evvmsId)}`);
  return { transactionId: res?.transactionId || res?.TransactionID || null, raw: res };
}

export async function getTransactionStatus(credentials, transactionId) {
  const res = await request(
    credentials,
    'GET',
    `/visits/transactions/${encodeURIComponent(transactionId)}`
  );
  // Shape varies slightly by environment; normalize what the queue needs.
  const first = Array.isArray(res) ? res[0] : res;
  return {
    status: first?.status || first?.Status || null,
    evvmsId: first?.evvmsId || first?.EVVMSID || first?.evvmsid || null,
    message: first?.message || first?.Message || null,
    raw: res,
  };
}

// Cheap connectivity/credential check for the admin UI — authenticates only,
// sends no data.
export async function testConnection(credentials) {
  try {
    clearTokenCache(credentials.organizationId);
    await getAccessToken(credentials);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { EvvApiError };
