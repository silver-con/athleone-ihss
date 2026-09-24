// Export state of one closed visit, for the EVV Export page (2026-09-24).
// Pure: takes the visit, its latest sync row and the pre-send validation
// problems (lib/evv-mapping.js validateVisitPayload) and says where the
// visit stands. Order matters — the first thing that applies wins.

export const EXPORT_STATES = {
  needs_maintenance: { label: 'Needs visit maintenance', tone: 'danger' },
  on_hold: { label: 'On hold', tone: 'warning' },
  blocked: { label: 'Blocked — missing or invalid data', tone: 'danger' },
  rejected: { label: 'Rejected by the state', tone: 'danger' },
  not_queued: { label: 'Ready — not queued', tone: 'neutral' },
  queued: { label: 'Queued to send', tone: 'neutral' },
  sent: { label: 'Sent — awaiting the state', tone: 'warning' },
  accepted: { label: 'Accepted by the state', tone: 'success' },
};

export const EXPORT_STATE_ORDER = ['needs_maintenance', 'blocked', 'rejected', 'on_hold', 'not_queued', 'queued', 'sent', 'accepted'];

export function exportState({ visit, latestSync, problems = [] }) {
  if (visit?.evv?.exception && !visit.resolved) {
    return { key: 'needs_maintenance', detail: `Open exception ${visit.evv.exception}` };
  }
  if (visit?.exportHold) {
    return { key: 'on_hold', detail: visit.exportHold.reason || null };
  }
  const status = latestSync?.status;
  if (status === 'acknowledged') return { key: 'accepted', detail: null };
  if (status === 'sent') return { key: 'sent', detail: null };
  if (status === 'failed') {
    // lib/evv-sync.js marks a row failed with "Cannot transmit: …" when it
    // refused to send it at all (missing data, overlapping visits) — the
    // state never saw it, so that's "blocked", not "rejected by the state".
    // `problems` is the check re-run NOW: if the office has since fixed
    // whatever blocked it, it's ready to queue again.
    const err = latestSync.lastError || '';
    if (isLocalRefusal(latestSync)) {
      if (problems.length > 0) return { key: 'blocked', detail: problems.join('; ') };
      return { key: 'not_queued', detail: 'Fixed since the last attempt — queue it again.' };
    }
    return { key: 'rejected', detail: err || null };
  }
  if (problems.length > 0) return { key: 'blocked', detail: problems.join('; ') };
  if (status === 'pending') return { key: 'queued', detail: latestSync.attempts > 0 ? `Retrying (attempt ${latestSync.attempts + 1})` : null };
  return { key: 'not_queued', detail: null };
}

// True when the latest sync row failed because the sender refused to send
// it (the state never saw it) — the page re-runs the check for these.
export function isLocalRefusal(latestSync) {
  return latestSync?.status === 'failed' && String(latestSync.lastError || '').startsWith('Cannot transmit:');
}

// Which states still need something from the office.
export function needsAttention(key) {
  return ['needs_maintenance', 'blocked', 'rejected', 'not_queued'].includes(key);
}
