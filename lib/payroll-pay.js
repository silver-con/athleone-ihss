// Payroll pay (2026-09-28): gross pay from verified hours and the agency's
// own pay rates. Pure functions; money is whole cents. Builds on the hours
// report from lib/payroll-hours.js.
//
// How pay is worked out (federal overtime rules for agency-employed home
// care attendants):
//   1. Straight time: each verified visit's clock-in-to-clock-out hours ×
//      the attendant's rate for that client (a per-client rate if set,
//      else the attendant's default rate).
//   2. Overtime, per Monday–Sunday workweek: hours past 40 are owed an
//      extra half of the "regular rate". With more than one rate in a week,
//      the regular rate is the week's straight-time pay ÷ its hours (the
//      weighted average). Premium = overtime hours × 0.5 × regular rate.
//   3. A week's overtime premium is paid in the pay period in which the
//      week ENDS (its Sunday), even when a twice-a-month period splits the
//      week — the straight time was already paid as it was worked.
// Tax withholding, deductions and filings stay with the payroll provider.
import { mondayOf, addDays } from './calendar.js';
import { lineState, workedMinutes, OVERTIME_THRESHOLD_HOURS } from './payroll-hours.js';

export const FEDERAL_MINIMUM_WAGE = 7.25; // also the Texas minimum wage
export const MAX_RATE = 500;

// "15", "15.5", "$15.50" -> 1550 cents. Throws a staff-readable Error.
export function parseRate(input) {
  const s = String(input ?? '').trim().replace(/^\$/, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new Error('Enter an hourly rate like 12.50.');
  const cents = Math.round(Number(s) * 100);
  if (cents < FEDERAL_MINIMUM_WAGE * 100) throw new Error(`That is below the minimum wage ($${FEDERAL_MINIMUM_WAGE.toFixed(2)} an hour).`);
  if (cents > MAX_RATE * 100) throw new Error(`Hourly rates above $${MAX_RATE} aren't accepted — check the number.`);
  return cents;
}

export const money = (cents) =>
  cents == null ? '—' : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const plainMoney = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

// rates: [{ caregiverId, clientId|null, rateCents }]
export function rateFor(rates, caregiverId, clientId) {
  const client = rates.find((r) => r.caregiverId === caregiverId && r.clientId && r.clientId === clientId);
  if (client) return { rateCents: client.rateCents, source: 'client' };
  const def = rates.find((r) => r.caregiverId === caregiverId && !r.clientId);
  return def ? { rateCents: def.rateCents, source: 'default' } : null;
}

const linePay = (minutes, rateCents) => Math.round((minutes * rateCents) / 60);

// What a visit looked like when a period was approved; any difference later
// is shown as "changed since approval".
export function fingerprint(line) {
  return [line.state, line.verifiedMinutes ?? '', line.rateCents ?? '', line.clockIn ?? '', line.clockOut ?? ''].join('|');
}

// Adds pay to an hours report (buildPayrollReport). `rows` is the same span
// the report was built from (every workweek the period touches).
export function addPay(report, { rows = [], rates = [], today }) {
  const { period } = report;
  const threshold = OVERTIME_THRESHOLD_HOURS * 60;

  // Every verified visit in the span, grouped by attendant and workweek.
  const weeksByCg = new Map();
  const names = new Map();
  for (const r of rows) {
    const v = r.visit;
    names.set(v.caregiverId, { name: r.caregiverName, role: r.caregiverRole });
    if (lineState(v, today) !== 'verified') continue;
    const minutes = workedMinutes(v);
    const rate = rateFor(rates, v.caregiverId, v.clientId);
    const monday = mondayOf(v.serviceDate);
    const weeks = weeksByCg.get(v.caregiverId) || new Map();
    const w = weeks.get(monday) || { monday, sunday: addDays(monday, 6), minutes: 0, straightCents: 0, missingRate: false };
    w.minutes += minutes;
    if (rate) w.straightCents += linePay(minutes, rate.rateCents);
    else w.missingRate = true;
    weeks.set(monday, w);
    weeksByCg.set(v.caregiverId, weeks);
  }

  const weekPay = (w) => {
    const overtimeMinutes = Math.max(0, w.minutes - threshold);
    const premiumCents = overtimeMinutes && !w.missingRate ? Math.round((w.straightCents * overtimeMinutes) / w.minutes / 2) : overtimeMinutes ? null : 0;
    return {
      ...w,
      overtimeMinutes,
      regularRateCents: w.minutes && !w.missingRate ? Math.round((w.straightCents * 60) / w.minutes) : null,
      premiumCents,
      paidThisPeriod: w.sunday >= period.from && w.sunday <= period.to,
    };
  };

  // An attendant whose only overtime week ends in this period but who has
  // no visit inside it still has to be paid the premium.
  const byId = new Map(report.attendants.map((a) => [a.caregiverId, a]));
  for (const [cgId, weeks] of weeksByCg) {
    if (byId.has(cgId)) continue;
    const owes = [...weeks.values()].map(weekPay).some((w) => w.paidThisPeriod && w.overtimeMinutes);
    if (!owes) continue;
    const n = names.get(cgId) || {};
    const empty = { caregiverId: cgId, name: n.name || 'Unknown attendant', role: n.role || '', lines: [], attention: [], weeks: [], overtime: true,
      totals: { visits: 0, scheduledMinutes: 0, verifiedMinutes: 0, billMinutes: 0, varianceMinutes: 0 } };
    report.attendants.push(empty);
    byId.set(cgId, empty);
  }
  report.attendants.sort((x, y) => x.name.localeCompare(y.name));

  for (const a of report.attendants) {
    const missingRate = [];
    let straightCents = 0;
    for (const l of a.lines) {
      if (l.state !== 'verified') continue;
      const rate = rateFor(rates, a.caregiverId, l.clientId);
      l.rateCents = rate?.rateCents ?? null;
      l.rateSource = rate?.source ?? null;
      l.payCents = rate ? linePay(l.verifiedMinutes, rate.rateCents) : null;
      if (rate) straightCents += l.payCents;
      else missingRate.push(l);
    }
    const weeks = [...(weeksByCg.get(a.caregiverId) || new Map()).values()]
      .map(weekPay)
      .filter((w) => w.sunday >= period.from && w.monday <= period.to)
      .sort((x, y) => x.monday.localeCompare(y.monday));
    const paidWeeks = weeks.filter((w) => w.paidThisPeriod);
    const unknownPremium = paidWeeks.some((w) => w.premiumCents == null);
    const premiumCents = paidWeeks.reduce((n, w) => n + (w.premiumCents || 0), 0);
    a.payWeeks = weeks;
    a.pay = {
      straightCents,
      overtimeMinutes: paidWeeks.reduce((n, w) => n + w.overtimeMinutes, 0),
      premiumCents,
      grossCents: missingRate.length || unknownPremium ? null : straightCents + premiumCents,
      missingRate,
      unknownPremium,
      deferredWeeks: weeks.filter((w) => !w.paidThisPeriod && w.overtimeMinutes),
    };
  }

  const pays = report.attendants.map((a) => a.pay);
  report.summary.attendants = report.attendants.length;
  report.summary.pay = {
    grossCents: pays.some((p) => p.grossCents == null) ? null : pays.reduce((n, p) => n + p.grossCents, 0),
    knownGrossCents: pays.reduce((n, p) => n + p.straightCents + p.premiumCents, 0),
    premiumCents: pays.reduce((n, p) => n + p.premiumCents, 0),
    missingRateVisits: pays.reduce((n, p) => n + p.missingRate.length, 0),
    missingRateAttendants: report.attendants.filter((a) => a.pay.missingRate.length || a.pay.unknownPremium).map((a) => a.caregiverId),
  };
  return report;
}

// --- approval -------------------------------------------------------------

// Why a period can't be approved yet ([] = it can).
export function approvalBlockers(report, today) {
  const out = [];
  const { period, summary } = report;
  if (!['semimonthly', 'weekly'].includes(period.frequency)) out.push('Only a regular pay period can be approved, not a custom date range.');
  if (period.to >= today) out.push('The pay period hasn’t ended yet.');
  if (summary.needsAttention) out.push(`${summary.needsAttention} visit(s) still need fixing in visit maintenance.`);
  if (summary.pay?.missingRateVisits) out.push(`${summary.pay.missingRateVisits} verified visit(s) have no pay rate — add rates first.`);
  else if (summary.pay?.grossCents == null && summary.pay) out.push('Overtime can’t be worked out until every visit in that workweek has a pay rate.');
  if (!summary.verifiedVisits && !summary.pay?.premiumCents) out.push('There are no verified hours to approve.');
  return out;
}

// The frozen copy stored with an approval.
export function buildSnapshot(report, generatedAt = new Date().toISOString()) {
  const attendants = report.attendants
    .map((a) => ({
      caregiverId: a.caregiverId,
      name: a.name,
      role: a.role,
      totals: a.totals,
      pay: { straightCents: a.pay.straightCents, overtimeMinutes: a.pay.overtimeMinutes, premiumCents: a.pay.premiumCents, grossCents: a.pay.grossCents },
      payWeeks: a.payWeeks.map(({ monday, sunday, minutes, overtimeMinutes, regularRateCents, premiumCents, paidThisPeriod }) => ({ monday, sunday, minutes, overtimeMinutes, regularRateCents, premiumCents, paidThisPeriod })),
      lines: a.lines
        .filter((l) => l.state === 'verified')
        .map((l) => ({
          visitId: l.visitId, serviceDate: l.serviceDate, start: l.start, end: l.end, clockIn: l.clockIn, clockOut: l.clockOut,
          clientId: l.clientId, clientName: l.clientName, serviceCode: l.serviceCode, modifiers: l.modifiers, state: 'verified',
          scheduledMinutes: l.scheduledMinutes, verifiedMinutes: l.verifiedMinutes, billMinutes: l.billMinutes, adjusted: l.adjusted,
          rateCents: l.rateCents, rateSource: l.rateSource, payCents: l.payCents,
        })),
    }))
    .filter((a) => a.lines.length || a.pay.premiumCents);
  const fingerprints = {};
  for (const a of attendants) for (const l of a.lines) fingerprints[l.visitId] = fingerprint(l);
  return {
    period: report.period,
    generatedAt,
    summary: {
      attendants: attendants.length,
      verifiedVisits: report.summary.verifiedVisits,
      verifiedMinutes: report.summary.verifiedMinutes,
      scheduledMinutes: report.summary.scheduledMinutes,
      grossCents: report.summary.pay.grossCents,
      premiumCents: report.summary.pay.premiumCents,
    },
    attendants,
    fingerprints,
  };
}

// Differences between an approved snapshot and the live report.
export function changesSinceApproval(snapshot, report) {
  if (!snapshot) return [];
  const live = new Map();
  for (const a of report.attendants) for (const l of a.lines) live.set(l.visitId, { a, l });
  const out = [];
  for (const [visitId, fp] of Object.entries(snapshot.fingerprints || {})) {
    const now = live.get(visitId);
    const was = snapshot.attendants.flatMap((a) => a.lines.map((l) => ({ a, l }))).find((x) => x.l.visitId === visitId);
    if (!now || now.l.state !== 'verified') out.push({ visitId, kind: 'removed', attendant: was?.a.name, serviceDate: was?.l.serviceDate, detail: now ? `now “${now.l.state.replace('_', ' ')}”` : 'no longer in this period' });
    else if (fingerprint(now.l) !== fp) out.push({ visitId, kind: 'changed', attendant: now.a.name, serviceDate: now.l.serviceDate, detail: `hours or rate changed (approved ${((was?.l.verifiedMinutes || 0) / 60).toFixed(2)} hrs at ${money(was?.l.rateCents)}, now ${((now.l.verifiedMinutes || 0) / 60).toFixed(2)} hrs at ${money(now.l.rateCents)})` });
  }
  for (const [visitId, { a, l }] of live) {
    if (l.state === 'verified' && !(visitId in (snapshot.fingerprints || {}))) out.push({ visitId, kind: 'added', attendant: a.name, serviceDate: l.serviceDate, detail: 'verified after the period was approved' });
  }
  return out.sort((x, y) => String(x.serviceDate).localeCompare(String(y.serviceDate)));
}

// --- CSV ----------------------------------------------------------------

function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const hrs = (m) => ((m || 0) / 60).toFixed(2);

export const SUMMARY_COLUMNS = [
  'Attendant ID', 'Attendant', 'Pay period start', 'Pay period end', 'Verified visits', 'Hours worked',
  'Straight-time pay', 'Overtime hours (weeks ending this period)', 'Overtime premium (0.5x)', 'Gross pay',
];

// One row per attendant: what most payroll providers import. Needs pay.
export function payrollSummaryCsv(report) {
  const rows = [SUMMARY_COLUMNS];
  for (const a of report.attendants) {
    rows.push([
      a.caregiverId, a.name, report.period.from, report.period.to, a.totals.visits, hrs(a.totals.verifiedMinutes),
      plainMoney(a.pay.straightCents), hrs(a.pay.overtimeMinutes), plainMoney(a.pay.premiumCents), plainMoney(a.pay.grossCents),
    ]);
  }
  return toCsv(rows);
}

export const DETAIL_PAY_COLUMNS = ['Rate', 'Rate source', 'Straight-time pay'];
