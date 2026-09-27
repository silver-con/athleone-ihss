// Turns an approved fax's authorization detail (saved on the referral in
// referrals.fax) into a service authorization — the client's care plan —
// when intake completes. Pure, no I/O: QA tests it directly.
//
// Returns the data for createServiceAuthorization, or null when the fax
// didn't carry enough to make one (no service code or no dates); the office
// then adds it by hand on the care-plan page, as before.

function usToIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function num(s) {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(String(s || ''));
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

// "BATHING, Dressing, Grooming (Shaving, Oral care), Toileting" ->
// ["Bathing", "Dressing", "Grooming (Shaving, Oral care)", "Toileting"] —
// commas inside brackets don't split.
export function splitTasks(raw) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of String(raw || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out
    .map((t) => t.replace(/\s+/g, ' ').replace(/[.]+$/, '').trim())
    .filter(Boolean)
    .map((t) => (t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t));
}

export function authStatusFromFax(s) {
  const v = String(s || '').toLowerCase();
  if (/approv/.test(v) && !/partial/.test(v)) return 'approved';
  if (/den|reject|cancel/.test(v)) return 'denied';
  return 'pending'; // pended, in review, partial, or not stated on the fax: office confirms
}

// Overall status and the primary line's status together: the stricter wins.
export function careStatus(overall, line) {
  const a = authStatusFromFax(overall);
  if (!line) return a;
  const b = authStatusFromFax(line);
  if (a === 'denied' || b === 'denied') return 'denied';
  if (a === 'approved' && b === 'approved') return 'approved';
  return 'pending';
}

export function authorizationFromFax(referral, clientId) {
  const fax = referral?.fax || {};
  const codeParts = String(fax.serviceCode || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const serviceCode = codeParts[0] || null;
  const startDate = usToIso(fax.authStart);
  const endDate = usToIso(fax.authEnd);
  if (!serviceCode || !startDate || !endDate) return null;
  const modifiers = [...new Set([...codeParts.slice(1), ...String(fax.modifier || '').toUpperCase().split(/[\s,]+/)].filter((m) => /^[A-Z0-9]{2}$/.test(m)))];
  const diagnosisCode = fax.diagnosisCode || (/\(([A-TV-Z]\d{2}(?:\.?[A-Z0-9]{1,4})?)\)\s*$/i.exec(referral.diagnosis || '')?.[1] ?? null);
  const diagnosisDescription = String(referral.diagnosis || '').replace(/\s*\([A-TV-Z]\d{2}(?:\.?[A-Z0-9]{1,4})?\)\s*$/i, '').trim() || null;
  const hours = num(referral.authHours);
  // Units may be stated per day or per month; the care plan keeps them per week.
  const rawUnits = num(fax.unitsPerWeek);
  const period = String(fax.frequencyPeriod || '');
  const units = rawUnits == null ? null : /day/i.test(period) ? rawUnits * 7 : /month/i.test(period) ? Math.round((rawUnits * 12) / 52) : rawUnits;
  // Other service lines on the fax aren't turned into care-plan entries
  // automatically; they're listed so the office adds the ones that apply.
  const lines = Array.isArray(fax.serviceLines) ? fax.serviceLines : [];
  const primary = Number.isInteger(fax.primaryLine) ? fax.primaryLine : 0;
  const others = lines
    .filter((_, i) => i !== primary)
    .map((l) => [[l.serviceCode, l.modifier].filter(Boolean).join(' '), l.serviceType, l.authStart && l.authEnd ? `${l.authStart}–${l.authEnd}` : null, l.lineStatus].filter(Boolean).join(', '))
    .filter(Boolean);
  const notes = [
    `Created from the fax${fax.fileName ? ` "${fax.fileName}"` : ''} at intake — check it against the fax.`,
    fax.totalUnits ? `Total units on the fax: ${fax.totalUnits}.` : null,
    (fax.idAcknowledgments || []).some((r) => r.state === 'missing')
      ? `IDs missing when the fax was approved: ${fax.idAcknowledgments.filter((r) => r.state === 'missing').map((r) => `${r.label} (${(r.reasonLabel || r.reason || '').toLowerCase()})`).join('; ')}.`
      : null,
    others.length ? `This fax had ${others.length} other service line${others.length === 1 ? '' : 's'} — add ${others.length === 1 ? 'it' : 'them'} if they apply: ${others.join('; ')}.` : null,
    rawUnits != null && units !== rawUnits ? `Fax states ${rawUnits} units per ${period.toLowerCase()} (${units} per week).` : null,
    fax.reviewDate ? `Payer review date: ${fax.reviewDate}.` : null,
    fax.coordinator?.name ? `Service coordinator: ${[fax.coordinator.name, fax.coordinator.phone, fax.coordinator.email].filter(Boolean).join(' · ')}.` : null,
    fax.pcp?.name ? `PCP: ${[fax.pcp.name, fax.pcp.phone, fax.pcp.fax ? `fax ${fax.pcp.fax}` : null].filter(Boolean).join(' · ')}.` : null,
    fax.program ? `Program: ${fax.program}.` : null,
    fax.serviceDays ? `Service days: ${fax.serviceDays}.` : null,
    fax.backupPlan ? `Backup plan: ${fax.backupPlan}.` : null,
    fax.dischargeDate ? `Hospital discharge: ${fax.dischargeDate}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    clientId,
    payer: referral.payer,
    caseId: fax.caseId || null,
    referenceNumber: referral.authNumber || null,
    serviceCode,
    serviceDescription: referral.service || serviceCode,
    modifierCodes: modifiers.length ? modifiers.join(' ') : null,
    diagnosisCode: diagnosisCode ? diagnosisCode.toUpperCase() : null,
    diagnosisDescription,
    totalHoursPerWeek: hours,
    totalUnitsPerWeek: units ?? (hours != null ? Math.round(hours * 4) : null),
    unitMinutes: 15,
    frequency: 'Weekly',
    startDate,
    endDate,
    status: careStatus(fax.authStatus, fax.lineStatus),
    purchasedTasks: splitTasks(fax.approvedTasks),
    notes,
  };
}
