// The EVV sync engine: decides what to transmit to the state aggregator,
// when to retry, and how to interpret what comes back.
//
// Two rules drive the design:
//
//   1. Nothing here may ever block a caregiver. Clocking in or out writes to
//      Hearth's own database and enqueues a row; if the aggregator is slow,
//      down, or rejecting, the caregiver in the client's home never sees it.
//      Sending happens separately.
//
//   2. A failed transmission is never silently swallowed. Every row ends up
//      acknowledged or failed-with-a-reason, visible to office staff. "We
//      thought we sent it" is how agencies fail an EVV usage audit.
import * as db from '@/lib/queries';
import * as api from '@/lib/hhaexchange';
import { buildVisitPayload, validateVisitPayload } from '@/lib/evv-mapping';

const MAX_ATTEMPTS = 5;

// Exponential backoff with a ceiling: 1, 2, 4, 8, 16 minutes.
function backoffUntil(attempts) {
  const minutes = Math.min(2 ** attempts, 16);
  return new Date(Date.now() + minutes * 60_000);
}

async function loadVisitContext(organizationId, visitId) {
  const visit = await db.getVisit(organizationId, visitId);
  if (!visit) return null;
  const [client, caregiver] = await Promise.all([
    db.getClient(organizationId, visit.clientId),
    db.getCaregiver(organizationId, visit.caregiverId),
  ]);
  const authorization = await db.getActiveAuthorization(organizationId, visit.clientId);
  return { visit, client, caregiver, authorization };
}

// Send everything currently due for one tenant. Returns a small summary the
// admin UI can show directly.
export async function processQueue(organizationId, { limit = 25 } = {}) {
  const credentials = await db.getEvvCredentials(organizationId);
  if (!credentials) {
    return { skipped: true, reason: 'No EVV credentials configured for this agency.' };
  }
  if (credentials.status === 'disabled') {
    return { skipped: true, reason: 'EVV transmission is disabled for this agency.' };
  }

  const due = await db.getSyncRowsDue(organizationId, limit);
  let sent = 0;
  let failed = 0;

  for (const row of due) {
    try {
      if (row.operation === 'visit_delete') {
        if (!row.evvmsId) throw new Error('Cannot delete a visit the aggregator never acknowledged.');
        const res = await api.deleteVisit(credentials, row.evvmsId);
        await db.updateSyncRow(organizationId, row.id, {
          status: 'sent',
          transactionId: res.transactionId,
          incrementAttempts: true,
        });
        sent += 1;
        continue;
      }

      const context = await loadVisitContext(organizationId, row.visitId);
      if (!context) throw new Error('Visit no longer exists.');

      const payload = buildVisitPayload({ credentials, ...context });
      const problems = validateVisitPayload(payload);
      if (problems.length > 0) {
        // A payload that can't satisfy the Cures Act elements will be
        // rejected anyway — fail it here with a readable reason instead of
        // burning retries on a request that cannot succeed.
        await db.updateSyncRow(organizationId, row.id, {
          status: 'failed',
          lastError: `Cannot transmit: ${problems.join('; ')}.`,
          payload,
          incrementAttempts: true,
        });
        failed += 1;
        continue;
      }

      const res =
        row.operation === 'visit_update' && row.evvmsId
          ? await api.updateVisit(credentials, row.evvmsId, payload)
          : await api.submitVisits(credentials, [payload]);

      await db.updateSyncRow(organizationId, row.id, {
        status: 'sent',
        transactionId: res.transactionId,
        payload,
        incrementAttempts: true,
      });
      sent += 1;
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.updateSyncRow(organizationId, row.id, {
        status: giveUp ? 'failed' : 'pending',
        lastError: String(err.message || err).slice(0, 500),
        nextAttemptAt: giveUp ? null : backoffUntil(attempts),
        incrementAttempts: true,
      });
      if (giveUp) failed += 1;
    }
  }

  if (sent > 0) {
    await db.setEvvCredentialStatus(
      organizationId,
      credentials.status === 'testing' ? 'testing' : credentials.status,
      { touchSuccess: true }
    );
  }

  return { skipped: false, attempted: due.length, sent, failed };
}

// The aggregator is asynchronous — submission only gets us a transaction id.
// This resolves those into acknowledged or failed.
export async function pollTransactions(organizationId, { limit = 25 } = {}) {
  const credentials = await db.getEvvCredentials(organizationId);
  if (!credentials) return { skipped: true, reason: 'No EVV credentials configured.' };

  const awaiting = await db.getSyncRowsAwaiting(organizationId, limit);
  let acknowledged = 0;
  let failed = 0;
  let stillPending = 0;

  for (const row of awaiting) {
    try {
      const res = await api.getTransactionStatus(credentials, row.transactionId);
      const status = String(res.status || '').toLowerCase();

      if (['success', 'succeeded', 'accepted', 'complete', 'completed'].includes(status)) {
        await db.updateSyncRow(organizationId, row.id, {
          status: 'acknowledged',
          evvmsId: res.evvmsId || row.evvmsId,
          lastError: null,
        });
        acknowledged += 1;
      } else if (['failed', 'error', 'rejected'].includes(status)) {
        await db.updateSyncRow(organizationId, row.id, {
          status: 'failed',
          lastError: res.message || 'Rejected by the aggregator.',
        });
        failed += 1;
      } else {
        stillPending += 1;
      }

      // The status endpoint is rate-limited to five calls per second per
      // consumer; stay well under it.
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      await db.updateSyncRow(organizationId, row.id, {
        lastError: String(err.message || err).slice(0, 500),
      });
    }
  }

  if (acknowledged > 0) {
    await db.setEvvCredentialStatus(organizationId, credentials.status, { touchSuccess: true });
  }

  return { skipped: false, checked: awaiting.length, acknowledged, failed, stillPending };
}

export async function runSyncCycle(organizationId) {
  const send = await processQueue(organizationId);
  if (send.skipped) return { send, poll: null };
  const poll = await pollTransactions(organizationId);
  return { send, poll };
}
