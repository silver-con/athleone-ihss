// Translates Hearth's own records into the HHAeXchange EVV Data Aggregator
// payload shape. Field names here follow the aggregator's published API
// contract (providerTaxID, Office/Member/Caregiver qualifier+identifier
// pairs, externalVisitID, procedureCode, UTC timestamps), not Hearth's
// internal naming.
//
// The six Cures Act elements every visit must carry map as follows:
//   who performed the service  → Caregiver.identifier
//   who received it            → Member.identifier
//   the service type           → procedureCode (+ modifiers)
//   the date                   → scheduleStartTime / visitStartDateTime
//   start and end time         → visitStartDateTime / visitEndDateTime
//   location                   → callLatitude / callLongitude / serviceAddress
//
// ⚠ VERIFY BEFORE CERTIFICATION: the reason/action code table this module
// looks up (lib/state-compliance.js's aggregatorReasonMaps.hhaexchange,
// keyed by state) was built from the published Illinois specification,
// since the Texas-specific TX Web Service API guide was not reachable at
// build time. Confirm every mapping against the real Texas guide during
// the sandbox test suite rather than trusting this table — a wrong
// reason code is a rejected visit.
//
// This table used to live here as TX_TO_AGGREGATOR_REASON, hardcoded as
// if Texas were the only state that would ever transmit to HHAeXchange.
// It moved to lib/state-compliance.js (state-keyed, so a second state on
// the same vendor gets its own table instead of silently reusing Texas's)
// once Hearth stopped being Texas-only — see
// multi-state-expansion-architecture-spec.md (the project doc).
import { getAggregatorReasonMap, mapReasonCodeForAggregator } from '@/lib/state-compliance';
import {
  normalizeTin,
  isValidTin,
  isValidNpi,
  isValidMedicaidId,
  isValidHcpcs,
  isValidModifier,
} from '@/lib/client-identity';

const FALLBACK_MISSED_VISIT_DEFAULT = { reasonCode: '601', actionCode: '53' };

// Exported 2026-09-23 for clockOut()'s flexible-hours grace-period check
// (lib/queries.js) — same date+12-hour-label -> UTC-ISO conversion this
// module already relied on internally, now shared rather than
// reimplemented a second time.
export function toUtcIso(serviceDate, timeLabel) {
  // Visit times are stored as a date ("2026-09-14") plus a 12-hour label
  // ("9:00 AM"). The aggregator requires UTC; the agency operates in
  // US/Central, which the payload declares separately in `timezone`.
  if (!serviceDate || !timeLabel) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeLabel).trim());
  if (!m) return null;
  let hours = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') hours += 12;
  const minutes = parseInt(m[2], 10);

  // US/Central is UTC-5 during daylight saving and UTC-6 otherwise. Rather
  // than hand-rolling the rule, ask the runtime what the offset is for that
  // date in that zone.
  const naive = new Date(`${serviceDate}T00:00:00Z`);
  const offsetMinutes = centralOffsetMinutes(naive);
  const utcMs =
    naive.getTime() + (hours * 60 + minutes) * 60000 + offsetMinutes * 60000;
  return new Date(utcMs).toISOString().slice(0, 19);
}

// Positive number of minutes to ADD to a Central wall-clock time to get UTC
// (360 in standard time, 300 in daylight time).
function centralOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  });
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName');
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(part?.value || 'GMT-6');
  if (!match) return 360;
  const hours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  return -(hours * 60 + (hours < 0 ? -mins : mins));
}

// Formats any Date-parseable value as a 12-hour Central-time label
// ("2:47 PM") for the human-readable evv_clock_in/evv_clock_out display
// columns. The authoritative value is always the real evv_clock_in_at /
// evv_clock_out_at timestamp column — this is only what caregivers and
// office staff read on screen.
export function formatCentralTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function buildCaregiverPayload({ credentials, caregiver }) {
  const [firstName, ...rest] = (caregiver.name || '').split(' ');
  return {
    // Stored as typed (often 12-3456789); the aggregator wants 9 digits.
    providerTaxID: normalizeTin(credentials.providerTaxId) || undefined,
    qualifier: 'ExternalID',
    externalID: caregiver.id,
    firstName: firstName || caregiver.name,
    lastName: rest.join(' ') || firstName || '',
    email: caregiver.email || undefined,
    phoneNumber: (caregiver.phone || '').replace(/\D/g, '') || undefined,
    type: /nurse|rn|lvn/i.test(caregiver.role || '') ? 'Skilled' : 'Non-Skilled',
    hireDate: caregiver.hiredOn || undefined,
  };
}

export function buildVisitPayload({ credentials, visit, client, caregiver, authorization, state }) {
  const scheduleStart = toUtcIso(visit.serviceDate, visit.start);
  const scheduleEnd = toUtcIso(visit.serviceDate, visit.end);
  // Prefer the real captured timestamp (evv_clock_in_at / evv_clock_out_at,
  // written by lib/queries.js's clockIn/clockOut from the caregiver's own
  // device clock) over parsing the human-readable display label. The label
  // ("9:00 AM") is a lossy fallback for visits clocked in before this
  // column existed, or for hand-built fixtures that only set the label.
  const actualStart = visit.evv?.clockInAt
    ? new Date(visit.evv.clockInAt).toISOString().slice(0, 19)
    : visit.evv?.clockIn
      ? toUtcIso(visit.serviceDate, visit.evv.clockIn)
      : null;
  const actualEnd = visit.evv?.clockOutAt
    ? new Date(visit.evv.clockOutAt).toISOString().slice(0, 19)
    : visit.evv?.clockOut
      ? toUtcIso(visit.serviceDate, visit.evv.clockOut)
      : null;

  const reasonMap = getAggregatorReasonMap(state, 'hhaexchange');
  const missedVisitDefault = reasonMap?.missedVisitDefault || FALLBACK_MISSED_VISIT_DEFAULT;

  const payload = {
    // Stored as typed (often 12-3456789); the aggregator wants 9 digits.
    providerTaxID: normalizeTin(credentials.providerTaxId) || undefined,
    Office: {
      qualifier: credentials.officeQualifier || 'NPI',
      identifier: credentials.officeIdentifier,
    },
    Member: {
      qualifier: 'MedicaidID',
      // The member's 9-digit Texas Medicaid ID. Deliberately NO fallback:
      // this used to fall back to hhsc_individual_number and then to
      // Hearth's internal client id, which the aggregator rejects. A
      // client with no Medicaid ID on file now fails validateVisitPayload
      // with a readable reason instead of being sent with a wrong ID.
      identifier: client?.medicaidId || undefined,
    },
    Caregiver: {
      qualifier: 'ExternalID',
      identifier: visit.caregiverId,
    },
    payerID: credentials.payerId,
    externalVisitID: visit.id,
    procedureCode: authorization?.serviceCode ? String(authorization.serviceCode).trim().toUpperCase() : undefined,
    procedureModifierCode: authorization?.modifierCodes
      ? String(authorization.modifierCodes).toUpperCase().split(/[,\s]+/).filter(Boolean)
      : undefined,
    timezone: 'US/Central',
    scheduleStartTime: scheduleStart,
    scheduleEndTime: scheduleEnd,
  };

  if (visit.status === 'missed') {
    payload.missed = true;
    const mapped = visit.evv?.exception
      ? mapReasonCodeForAggregator(reasonMap, visit.evv.exception)
      : null;
    payload.reasonCode = mapped?.reasonCode || missedVisitDefault.reasonCode;
    payload.actionCode = mapped?.actionCode || missedVisitDefault.actionCode;
    if (visit.evv?.note) payload.notes = visit.evv.note;
    return payload;
  }

  if (actualStart) {
    payload.visitStartDateTime = actualStart;
    payload.clockIn = {
      callDateTime: actualStart,
      callType: /telephon/i.test(visit.evv?.method || '') ? 'Telephony' : 'Mobile',
      callLatitude: visit.evv?.clockInLat ?? undefined,
      callLongitude: visit.evv?.clockInLng ?? undefined,
      serviceAddress: client?.address ? { addressLine1: client.address } : undefined,
    };
  }

  if (actualEnd) {
    payload.visitEndDateTime = actualEnd;
    payload.clockOut = {
      callDateTime: actualEnd,
      callType: /telephon/i.test(visit.evv?.method || '') ? 'Telephony' : 'Mobile',
      callLatitude: visit.evv?.clockOutLat ?? undefined,
      callLongitude: visit.evv?.clockOutLng ?? undefined,
      performedTasks: (visit.tasks || []).filter((t) => t.done).map((t) => t.id),
      refusedTasks: (visit.tasks || []).filter((t) => !t.done).map((t) => t.id),
      serviceAddress: client?.address ? { addressLine1: client.address } : undefined,
    };
  }

  // Any visit carrying an exception is an edited/manually-documented visit
  // as far as the aggregator is concerned, and must declare why.
  if (visit.evv?.exception) {
    const mapped = mapReasonCodeForAggregator(reasonMap, visit.evv.exception);
    payload.edited = true;
    payload.reasonCode = mapped?.reasonCode || '222';
    payload.actionCode = mapped?.actionCode || '25';
    if (visit.evv?.note) payload.notes = visit.evv.note;
  }

  return payload;
}

// The Cures Act requires all six elements. A visit missing any of them will
// be rejected by the aggregator, so it is worth catching before we transmit
// rather than discovering it in a failed transaction.
//
// Beyond presence, this also checks FORMAT the same way Vesta's own
// pre-export validation does (Vesta Web FMSA Guide, "Vesta EVV
// Validation"): Medicaid ID 9 digits, TIN 9 digits, NPI 10 digits with a
// valid check digit, HCPCS/modifier shape. It does not (can't) check that
// an ID actually belongs to this member — the aggregator does that.
export function validateVisitPayload(payload) {
  const problems = [];
  if (!payload.Caregiver?.identifier) problems.push('no caregiver identifier');

  const memberId = payload.Member?.identifier;
  if (!memberId) problems.push("client has no Medicaid ID on file (add it on the client's care-plan page)");
  else if (!isValidMedicaidId(memberId)) problems.push('client Medicaid ID must be exactly 9 digits');

  if (!payload.procedureCode) problems.push('no service code (client has no active authorization)');
  else if (!isValidHcpcs(payload.procedureCode)) {
    problems.push(`service code "${payload.procedureCode}" is not a valid HCPCS code (e.g. S5125, T1019)`);
  }
  const badModifiers = (payload.procedureModifierCode || []).filter((m) => !isValidModifier(m));
  if (badModifiers.length > 0) problems.push(`invalid modifier(s): ${badModifiers.join(', ')} (each must be 2 characters, e.g. U3)`);

  if (!payload.scheduleStartTime || !payload.scheduleEndTime) problems.push('no schedule times');
  if (!payload.missed && !payload.visitStartDateTime) problems.push('no actual visit start time');

  if (!payload.providerTaxID) problems.push('no provider tax ID configured');
  else if (!isValidTin(payload.providerTaxID)) problems.push('provider tax ID (TIN) must be 9 digits');

  if (!payload.Office?.identifier) problems.push('no office identifier configured');
  else if (payload.Office.qualifier === 'NPI' && !isValidNpi(payload.Office.identifier)) {
    problems.push('office NPI is not a valid 10-digit NPI (check digit does not match)');
  }
  return problems;
}
