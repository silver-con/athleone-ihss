// Missing or doubtful IDs need a reviewer's acknowledgment before a fax is
// approved — whether or not the field is required. A missing Medicaid ID or
// authorization # never slips through silently: the reviewer picks a reason,
// it's saved with the referral, written to the Audit Log, and shown as
// "Missing IDs" until it's filled in.
//
//   blocked  — required for this document type and empty: must be entered
//              (validateFields already reports it as an error)
//   missing  — not required here, but empty: acknowledge with a reason
//   doubtful — present but read with low confidence, or fails its format
//              check: check it against the fax, or acknowledge
// Pure — used by the review screen and re-checked on the server.
import { LOW_CONFIDENCE } from './validate.js';

// Checked when empty AND when doubtful.
export const KEY_IDS = [
  ['medicaidId', 'Medicaid ID'],
  ['authNumber', 'Authorization #'],
  ['serviceCode', 'Procedure code'],
  ['diagnosisCode', 'Diagnosis code'],
];
// Checked only when present but doubtful (often legitimately absent).
export const OTHER_IDS = [
  ['planMemberId', 'Plan member ID'],
  ['caseId', 'Payer case ID'],
  ['providerNpi', 'Provider NPI'],
];

export const ACK_REASONS = [
  ['not_on_fax', 'Not printed on the fax'],
  ['pending_payer', 'Pending from the payer'],
  ['from_client', 'Will get it from the client / family'],
  ['unreadable', 'Unreadable on the fax — resend requested'],
  ['checked', 'Checked against the fax — it’s correct'],
  ['other', 'Other (add a note)'],
];
const REASON_KEYS = new Set(ACK_REASONS.map(([k]) => k));
// Which reasons make sense for each state.
export function reasonsFor(state) {
  return state === 'doubtful' ? ACK_REASONS.filter(([k]) => k !== 'not_on_fax' && k !== 'from_client') : ACK_REASONS.filter(([k]) => k !== 'checked');
}

// fields: { key: { value, confidence, source } }; issues: validateFields() output.
export function idChecks(fields = {}, issues = {}) {
  const out = [];
  const val = (k) => String(fields[k]?.value ?? '').trim();
  const hasError = (k) => (issues[k] || []).some((i) => i.level === 'error');
  const doubt = (k) => {
    const f = fields[k];
    if (f?.source === 'reviewer') return null; // typed or corrected by the reviewer = checked
    if (typeof f?.confidence === 'number' && f.confidence < LOW_CONFIDENCE) return 'Read with low confidence';
    const warn = (issues[k] || []).find((i) => i.level === 'warn');
    return warn ? warn.message : null;
  };
  for (const [key, label] of KEY_IDS) {
    if (hasError(key)) continue; // blocked: must be entered, no acknowledgment possible
    if (!val(key)) out.push({ key, label, state: 'missing', detail: 'Not found on the fax' });
    else {
      const d = doubt(key);
      if (d) out.push({ key, label, state: 'doubtful', detail: d });
    }
  }
  for (const [key, label] of OTHER_IDS) {
    if (hasError(key) || !val(key)) continue;
    const d = doubt(key);
    if (d) out.push({ key, label, state: 'doubtful', detail: d });
  }
  return out;
}

// acks: { key: { reason, note } }. Returns the checks still lacking a valid
// acknowledgment (empty = OK to approve).
export function unacknowledged(checks, acks = {}) {
  return checks.filter((c) => {
    const a = acks?.[c.key];
    if (!a || !REASON_KEYS.has(a.reason)) return true;
    if (!reasonsFor(c.state).some(([k]) => k === a.reason)) return true;
    if (a.reason === 'other' && !String(a.note || '').trim()) return true;
    return false;
  });
}

// What's saved with the referral / audit log (no ID values — reasons only).
export function acknowledgmentRecords(checks, acks = {}) {
  return checks.map((c) => ({
    field: c.key,
    label: c.label,
    state: c.state,
    reason: acks[c.key]?.reason,
    reasonLabel: ACK_REASONS.find(([k]) => k === acks[c.key]?.reason)?.[1] || null,
    note: String(acks[c.key]?.note || '').trim().slice(0, 200) || null,
  }));
}

// Short line for the audit log: "Medicaid ID missing (pending from the payer); …"
export function acknowledgmentSummary(records) {
  return records.map((r) => `${r.label} ${r.state} (${(r.reasonLabel || r.reason || '').toLowerCase()}${r.note ? `: ${r.note}` : ''})`).join('; ');
}

// IDs acknowledged as MISSING at approval that are still open on the
// referral (it hasn't completed intake, and the value hasn't been filled in).
export function openMissingIds(referral) {
  if (!referral || referral.status === 'completed') return [];
  const fax = referral.fax || {};
  const filled = { authNumber: referral.authNumber, medicaidId: fax.medicaidId, serviceCode: fax.serviceCode, diagnosisCode: fax.diagnosisCode };
  return (fax.idAcknowledgments || []).filter((r) => r.state === 'missing' && !String(filled[r.field] ?? '').trim());
}
