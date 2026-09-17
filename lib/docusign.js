// DocuSign eSignature API client — JWT Grant authentication + envelope
// creation, hand-rolled against the REST API rather than the official SDK
// (matches the no-heavy-dependency approach used for lib/hhaexchange.js).
//
// Unlike HHAeXchange, DocuSign's developer/demo environment is self-serve:
// anyone can create a free account at https://developers.docusign.com and
// get a real Integration Key to test against — there is no third-party
// sponsorship step. See the admin setup guide for the exact steps.
//
// Auth: JWT Grant (RFC 7523). The app holds an RSA private key whose public
// half was registered on the DocuSign "app" (Integration Key); it signs a
// short-lived JWT asserting it acts as a specific DocuSign user
// ("impersonation"), and exchanges that for an access token. The
// impersonated user must have granted one-time consent — see
// DocusignApiError.consentRequired below.
//
// Credentials are tenant-scoped, same pattern as HHAeXchange: every call
// takes this organization's own credentials row, decrypted only here.
import { SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { decryptSecret } from '@/lib/secrets';

const AUTH_HOST = { demo: 'account-d.docusign.com', production: 'account.docusign.com' };
const JWT_LIFETIME_SECONDS = 3600; // DocuSign's JWT assertion max lifetime
const TOKEN_SAFETY_WINDOW_MS = 60_000;

class DocusignApiError extends Error {
  constructor(message, { status, body, consentRequired = false } = {}) {
    super(message);
    this.name = 'DocusignApiError';
    this.status = status;
    this.body = body;
    this.consentRequired = consentRequired;
  }
}

// token + base URI are both per-tenant and both come from the same
// auth/userinfo round trip, so they're cached together.
const cache = new Map();

export function clearTokenCache(organizationId) {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}

function authHost(credentials) {
  return AUTH_HOST[credentials.environment] || AUTH_HOST.demo;
}

async function fetchAccessToken(credentials) {
  const host = authHost(credentials);
  const privateKeyPem = decryptSecret(credentials.privateKeyEnc);
  let key;
  try {
    // Node's own PEM parser auto-detects PKCS#1 ("-----BEGIN RSA PRIVATE
    // KEY-----", what DocuSign's own key generator and a plain `openssl
    // genrsa` both produce) as well as PKCS#8 ("-----BEGIN PRIVATE
    // KEY-----"), unlike jose's importPKCS8 which only accepts PKCS#8.
    // jose's SignJWT accepts a Node KeyObject directly, so there's no need
    // to convert formats by hand before pasting the key into the UI.
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new DocusignApiError(
      'The stored private key could not be parsed. Make sure the full RSA private key — including the -----BEGIN/END lines (either "PRIVATE KEY" or "RSA PRIVATE KEY") — was pasted in.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'signature impersonation' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(credentials.integrationKey)
    .setSubject(credentials.apiUsername)
    .setAudience(host)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_LIFETIME_SECONDS)
    .sign(key);

  const res = await fetch(`https://${host}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const errorCode = json?.error || '';
    if (errorCode === 'consent_required') {
      const consentUrl =
        `https://${host}/oauth/auth?response_type=code&scope=signature%20impersonation` +
        `&client_id=${encodeURIComponent(credentials.integrationKey)}` +
        `&redirect_uri=${encodeURIComponent('https://www.docusign.com')}`;
      throw new DocusignApiError(
        `DocuSign requires one-time consent for this integration before it can authenticate. Visit this URL, log in as the API user, and click Allow, then try again: ${consentUrl}`,
        { status: res.status, body: json, consentRequired: true }
      );
    }
    throw new DocusignApiError(`DocuSign authentication failed (HTTP ${res.status}) ${errorCode}`.trim(), {
      status: res.status,
      body: json,
    });
  }

  if (!json?.access_token) throw new DocusignApiError('DocuSign authentication returned no access token.');
  return json.access_token;
}

async function fetchUserInfo(host, accessToken) {
  const res = await fetch(`https://${host}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new DocusignApiError(`Could not read DocuSign account info (HTTP ${res.status})`);
  return res.json();
}

// Resolves { token, baseUri } for this tenant, using the cache when fresh.
// baseUri is per-account (e.g. https://demo.docusign.net/restapi) and is
// only discoverable via userinfo, so it's fetched and cached alongside the
// token rather than configured by hand.
async function getConnection(credentials) {
  const cached = cache.get(credentials.organizationId);
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) return cached;

  const host = authHost(credentials);
  const token = await fetchAccessToken(credentials);
  const userInfo = await fetchUserInfo(host, token);
  const accounts = userInfo?.accounts || [];
  const account =
    accounts.find((a) => a.account_id === credentials.accountId) ||
    accounts.find((a) => a.is_default) ||
    accounts[0];

  if (!account) {
    throw new DocusignApiError('This DocuSign user has no accounts visible to the integration.');
  }

  const connection = {
    token,
    baseUri: `${account.base_uri}/restapi`,
    accountId: account.account_id,
    accountName: account.account_name,
    expiresAt: Date.now() + 25 * 60 * 1000, // refresh well before the ~1hr DocuSign token expiry
  };
  cache.set(credentials.organizationId, connection);
  return connection;
}

async function apiRequest(credentials, method, path, payload) {
  const conn = await getConnection(credentials);
  const res = await fetch(`${conn.baseUri}/v2.1/accounts/${conn.accountId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${conn.token}`,
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
    if (res.status === 401) clearTokenCache(credentials.organizationId);
    const detail = json?.message || json?.errorCode || text?.slice(0, 300) || '';
    throw new DocusignApiError(`${method} ${path} failed (HTTP ${res.status}) ${detail}`.trim(), {
      status: res.status,
      body: json,
    });
  }
  return json;
}

// Cheap connectivity/credential check for the admin UI — authenticates and
// resolves the account, sends nothing.
export async function testConnection(credentials) {
  try {
    clearTokenCache(credentials.organizationId);
    const conn = await getConnection(credentials);
    return { ok: true, accountName: conn.accountName, accountId: conn.accountId };
  } catch (err) {
    return { ok: false, error: err.message, consentRequired: Boolean(err.consentRequired) };
  }
}

// Creates a sent envelope for one or more HTML documents, with a single
// signer. `embedded: true` uses a clientUserId so the signer can complete
// it inside Hearth via createRecipientView(); otherwise DocuSign emails the
// signer directly (used for the office-initiated Attendant Orientation,
// where there's no caregiver browser session to embed into).
export async function createEnvelope(credentials, { emailSubject, documents, signerEmail, signerName, embedded = false }) {
  const clientUserId = embedded ? `hearth-${credentials.organizationId}` : undefined;

  const envelopeDefinition = {
    emailSubject,
    status: 'sent',
    documents: documents.map((doc, i) => ({
      documentId: String(i + 1),
      name: doc.name,
      fileExtension: 'html',
      documentBase64: Buffer.from(doc.html, 'utf8').toString('base64'),
    })),
    recipients: {
      signers: [
        {
          email: signerEmail,
          name: signerName,
          recipientId: '1',
          routingOrder: '1',
          ...(clientUserId ? { clientUserId } : {}),
          tabs: {
            signHereTabs: documents.map((_, i) => ({
              documentId: String(i + 1),
              recipientId: '1',
              anchorString: `/sig${i + 1}/`,
              anchorUnits: 'pixels',
              anchorXOffset: '10',
              anchorYOffset: '-6',
            })),
            dateSignedTabs: documents.map((_, i) => ({
              documentId: String(i + 1),
              recipientId: '1',
              anchorString: `/date${i + 1}/`,
              anchorUnits: 'pixels',
              anchorXOffset: '10',
              anchorYOffset: '-6',
            })),
            fullNameTabs: documents.map((_, i) => ({
              documentId: String(i + 1),
              recipientId: '1',
              anchorString: `/name${i + 1}/`,
              anchorUnits: 'pixels',
              anchorXOffset: '10',
              anchorYOffset: '-6',
            })),
          },
        },
      ],
    },
  };

  const res = await apiRequest(credentials, 'POST', '/envelopes', envelopeDefinition);
  return { envelopeId: res.envelopeId, status: res.status };
}

// Only valid for an embedded (clientUserId) signer on the envelope. Returns
// a one-time-use signing URL to redirect the caregiver's browser to.
export async function createRecipientView(credentials, envelopeId, { signerEmail, signerName, returnUrl }) {
  const res = await apiRequest(credentials, 'POST', `/envelopes/${envelopeId}/views/recipient`, {
    returnUrl,
    authenticationMethod: 'none',
    email: signerEmail,
    userName: signerName,
    recipientId: '1',
    clientUserId: `hearth-${credentials.organizationId}`,
  });
  return res.url;
}

export async function getEnvelope(credentials, envelopeId) {
  const res = await apiRequest(credentials, 'GET', `/envelopes/${envelopeId}`);
  return { status: res.status, raw: res };
}

export { DocusignApiError };
