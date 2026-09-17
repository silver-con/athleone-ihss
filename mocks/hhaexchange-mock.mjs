// A local stand-in for the HHAeXchange EVV Data Aggregator.
//
// WHY THIS EXISTS: real sandbox ("Implementation environment") credentials
// are not self-serve. HHAeXchange issues them to a vendor only after the
// provider agency submits its onboarding form and attestation, and they are
// tied to that agency's Medicaid provider identity. So until the first
// tenant agency completes that step, there is nothing real to point at.
//
// This mock implements the documented contract exactly — same endpoints,
// same OAuth2 flow, same asynchronous transaction-id-then-poll behavior —
// so the entire pipeline (queue, transmit, poll, acknowledge, retry, fail)
// can be exercised now. Pointing Hearth at the real sandbox later is a
// change of base URL and credentials, not a change of code.
//
// It is NOT a substitute for certification testing against the real
// environment. It validates our plumbing, not their acceptance rules.
//
// Run with: npm run mock:evv
import { createServer } from 'http';

const PORT = Number(process.env.MOCK_EVV_PORT || 4010);

// Whatever the client authenticates with is accepted, except the reserved
// value below, which lets us exercise the auth-failure path deliberately.
const REJECTED_CLIENT_ID = 'bad-client';

const tokens = new Map();
const transactions = new Map();

// How long a transaction stays "Pending" before resolving, so the poller's
// wait-and-retry behavior is actually exercised rather than short-circuited.
const PROCESSING_MS = 1200;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function bearerOk(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const entry = tokens.get(token);
  return Boolean(entry && entry.expiresAt > Date.now());
}

function newTransaction(kind, records) {
  const id = `TX-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  // Deliberate failure case: any visit whose externalVisitID ends in
  // "-fail" is rejected, so error handling can be tested on demand.
  const failing = (records || []).find((r) => String(r?.externalVisitID || '').endsWith('-fail'));

  transactions.set(id, {
    id,
    kind,
    createdAt: Date.now(),
    evvmsId: `EVVMS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    outcome: failing ? 'Failed' : 'Success',
    message: failing
      ? 'Visit rejected: simulated validation failure (externalVisitID ends in -fail).'
      : null,
  });
  return id;
}

function transactionView(tx) {
  if (!tx) return null;
  const settled = Date.now() - tx.createdAt >= PROCESSING_MS;
  if (!settled) return { transactionId: tx.id, status: 'Pending', evvmsId: null, message: null };
  return {
    transactionId: tx.id,
    status: tx.outcome,
    evvmsId: tx.outcome === 'Success' ? tx.evvmsId : null,
    message: tx.message,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // --- OAuth2 token ---
  if (req.method === 'POST' && path === '/identity/connect/token') {
    const body = new URLSearchParams(await readBody(req));
    const clientId = body.get('client_id');
    const clientSecret = body.get('client_secret');

    if (!clientId || !clientSecret) {
      return json(res, 400, { error: 'invalid_request' });
    }
    if (clientId === REJECTED_CLIENT_ID) {
      return json(res, 401, { error: 'invalid_client' });
    }

    const token = `mock-${Math.random().toString(36).slice(2)}`;
    tokens.set(token, { clientId, expiresAt: Date.now() + 1800_000 });
    console.log(`[mock] token issued to client_id=${clientId}`);
    return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 1800 });
  }

  const apiMatch = /^\/api\/v[^/]+(\/.*)$/.exec(path);
  if (!apiMatch) return json(res, 404, { message: 'Not found' });
  const route = apiMatch[1];

  if (!bearerOk(req)) {
    return json(res, 401, { message: 'Missing or expired access token.' });
  }

  // --- Caregivers: one per call ---
  if (req.method === 'POST' && route === '/caregivers') {
    const record = JSON.parse((await readBody(req)) || '{}');
    if (Array.isArray(record)) {
      return json(res, 400, { message: 'Send one caregiver at a time.' });
    }
    const id = newTransaction('caregiver', [record]);
    console.log(`[mock] caregiver upsert externalID=${record.externalID} -> ${id}`);
    return json(res, 202, { transactionId: id });
  }

  // --- Visits: batch create ---
  if (req.method === 'POST' && route === '/visits') {
    const records = JSON.parse((await readBody(req)) || '[]');
    if (!Array.isArray(records)) {
      return json(res, 400, { message: 'Visits must be submitted as an array.' });
    }
    const missing = records.find(
      (r) => !r.providerTaxID || !r.Member?.identifier || !r.Caregiver?.identifier || !r.procedureCode
    );
    if (missing) {
      return json(res, 400, {
        message: 'Visit is missing a required element (providerTaxID, Member, Caregiver or procedureCode).',
      });
    }
    const id = newTransaction('visits', records);
    console.log(`[mock] ${records.length} visit(s) submitted -> ${id}`);
    return json(res, 202, { transactionId: id });
  }

  // --- Visits: update / delete by EVVMSID ---
  const visitIdMatch = /^\/visits\/([^/]+)$/.exec(route);
  if (visitIdMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const record = req.method === 'PUT' ? JSON.parse((await readBody(req)) || '{}') : {};
    const id = newTransaction('visit-' + req.method.toLowerCase(), [record]);
    console.log(`[mock] visit ${req.method} evvmsId=${visitIdMatch[1]} -> ${id}`);
    return json(res, 202, { transactionId: id });
  }

  // --- Transaction status ---
  const txMatch = /^\/visits\/transactions\/([^/]+)$/.exec(route);
  if (txMatch && req.method === 'GET') {
    const view = transactionView(transactions.get(txMatch[1]));
    if (!view) return json(res, 404, { message: 'Unknown transaction id.' });
    return json(res, 200, view);
  }

  return json(res, 404, { message: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[mock] HHAeXchange aggregator mock listening on http://localhost:${PORT}`);
  console.log('[mock] any client_id works except "bad-client"; visits ending "-fail" are rejected');
});
