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
// ⚠ VERIFY BEFORE CERTIFICATION: the reason/action code tables below are
// Hearth's mapping from the Texas HHSC reason codes the app already uses
// (lib/data.js REASON_CODES) onto aggregator codes. The published code list
// available to us at build time was the Illinois specification; Texas
// publishes its own list in the TX Web Service API guide. Confirm every
// mapping against the Texas guide during the sandbox test suite rather than
// trusting this table — a wrong reason code is a rejected visit.

export const TX_TO_AGGREGATOR_REASON = {
  '000': { reasonCode: '222', actionCode: '23' }, // overnight, system-generated
  '110A': { reasonCode: '211', actionCode: '21' }, // schedule variance
  '110B': { reasonCode: '206', actionCode: '21' }, // downward adjustment
  '110C': { reasonCode: '212', actionCode: '23' }, // overlapping visits
  '120': { reasonCode: '222', actionCode: '22' }, // eligibility / authorization
  '130': { reasonCode: '222', actionCode: '25' }, // disaster
  '210': { reasonCode: '210', actionCode: '19' }, // no electronic clock in/out
  '210I': { reasonCode: '218', actionCode: '19' }, // emergency, no clock in/out
  '310': { reasonCode: '219', actionCode: '23' }, // error during clock in/out
  '600': { reasonCode: '222', actionCode: '25' }, // other — requires a note
};

// Missed visits use the aggregator's separate missed-visit code set.
export const MISSED_VISIT_DEFAULT = { reasonCode: '601', actionCode: '53' };

function toUtcIso(serviceDate, timeLabel) {
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

export function buildCaregiverPayload({ credentials, caregiver }) {
  const [firstName, ...rest] = (caregiver.name || '').split(' ');
  return {
    providerTaxID: credentials.providerTaxId,
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

export function buildVisitPayload({ credentials, visit, client, caregiver, authorization }) {
  const scheduleStart = toUtcIso(visit.serviceDate, visit.start);
  const scheduleEnd = toUtcIso(visit.serviceDate, visit.end);
  const actualStart = visit.evv?.clockIn ? toUtcIso(visit.serviceDate, visit.evv.clockIn) : null;
  const actualEnd = visit.evv?.clockOut ? toUtcIso(visit.serviceDate, visit.evv.clockOut) : null;

  const payload = {
    providerTaxID: credentials.providerTaxId,
    Office: {
      qualifier: credentials.officeQualifier || 'NPI',
      identifier: credentials.officeIdentifier,
    },
    Member: {
      qualifier: 'MedicaidID',
      identifier: client?.hhscIndividualNumber || client?.id,
    },
    Caregiver: {
      qualifier: 'ExternalID',
      identifier: visit.caregiverId,
    },
    payerID: credentials.payerId,
    externalVisitID: visit.id,
    procedureCode: authorization?.serviceCode || undefined,
    procedureModifierCode: authorization?.modifierCodes
      ? String(authorization.modifierCodes).split(/[,\s]+/).filter(Boolean)
      : undefined,
    timezone: 'US/Central',
    scheduleStartTime: scheduleStart,
    scheduleEndTime: scheduleEnd,
  };

  if (visit.status === 'missed') {
    payload.missed = true;
    const mapped = visit.evv?.exception
      ? TX_TO_AGGREGATOR_REASON[visit.evv.exception]
      : null;
    payload.reasonCode = mapped?.reasonCode || MISSED_VISIT_DEFAULT.reasonCode;
    payload.actionCode = mapped?.actionCode || MISSED_VISIT_DEFAULT.actionCode;
    if (visit.evv?.note) payload.notes = visit.evv.note;
    return payload;
  }

  if (actualStart) {
    payload.visitStartDateTime = actualStart;
    payload.clockIn = {
      callDateTime: actualStart,
      callType: /telephon/i.test(visit.evv?.method || '') ? 'Telephony' : 'Mobile',
      serviceAddress: client?.address ? { addressLine1: client.address } : undefined,
    };
  }

  if (actualEnd) {
    payload.visitEndDateTime = actualEnd;
    payload.clockOut = {
      callDateTime: actualEnd,
      callType: /telephon/i.test(visit.evv?.method || '') ? 'Telephony' : 'Mobile',
      performedTasks: (visit.tasks || []).filter((t) => t.done).map((t) => t.id),
      refusedTasks: (visit.tasks || []).filter((t) => !t.done).map((t) => t.id),
      serviceAddress: client?.address ? { addressLine1: client.address } : undefined,
    };
  }

  // Any visit carrying an exception is an edited/manually-documented visit
  // as far as the aggregator is concerned, and must declare why.
  if (visit.evv?.exception) {
    const mapped = TX_TO_AGGREGATOR_REASON[visit.evv.exception];
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
export function validateVisitPayload(payload) {
  const problems = [];
  if (!payload.Caregiver?.identifier) problems.push('no caregiver identifier');
  if (!payload.Member?.identifier) problems.push('no member/client identifier');
  if (!payload.procedureCode) problems.push('no service code (client has no active authorization)');
  if (!payload.scheduleStartTime || !payload.scheduleEndTime) problems.push('no schedule times');
  if (!payload.missed && !payload.visitStartDateTime) problems.push('no actual visit start time');
  if (!payload.providerTaxID) problems.push('no provider tax ID configured');
  if (!payload.Office?.identifier) problems.push('no office identifier configured');
  return problems;
}
