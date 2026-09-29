// Payroll hours (2026-09-28): the hours each attendant worked in a pay
// period, laid out like the "Service Attendant Visit Log" agencies already
// hand to their payroll company. Pure functions (no I/O) so QA tests them
// directly; lib/queries.js getPayrollVisits() supplies the rows.
//
// What it does NOT do yet: pay rates, overtime pay, deductions. Those live
// in the agency's payroll system (the visit log's "Pay Code" column was
// empty). It does flag any workweek over 40 hours, because agency-employed
// attendants are owed overtime past 40 hours a week.
//
// Hours:
//   scheduled — the visit's scheduled start to end
//   verified  — the EVV clock-in to clock-out, counted only for a visit that
//               is completed, EVV-verified and has no open exception
//   bill      — what the visit bills for (scheduled, or lower after a 110 B
//               adjustment in visit maintenance)
// Variance = verified − scheduled, over verified visits (as on the log).
import { addDays, isIsoDate, todayIso, mondayOf } from './calendar.js';

export const PAY_FREQUENCIES = {
  semimonthly: 'Twice a month (1st–15th, 16th–end)',
  weekly: 'Weekly (Mon–Sun)',
};
export const OVERTIME_THRESHOLD_HOURS = 40;
// The FLSA workweek is any fixed 7 days the employer chooses. Athleone's
// schedule weeks run Monday–Sunday, so the overtime check uses the same.
export const WORKWEEK = 'Monday–Sunday';

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const pad = (n) => String(n).padStart(2, '0');

// The pay period containing `iso`.
export function payPeriodFor(iso, frequency = 'semimonthly') {
  const day = isIsoDate(iso) ? iso : todayIso();
  if (frequency === 'weekly') {
    const from = mondayOf(day);
    return { from, to: addDays(from, 6), frequency };
  }
  const [y, m, d] = day.split('-').map(Number);
  const ym = `${y}-${pad(m)}`;
  return d <= 15
    ? { from: `${ym}-01`, to: `${ym}-15`, frequency: 'semimonthly' }
    : { from: `${ym}-16`, to: `${ym}-${pad(lastDayOfMonth(y, m))}`, frequency: 'semimonthly' };
}

export function previousPeriod(period) {
  return payPeriodFor(addDays(period.from, -1), period.frequency);
}
export function nextPeriod(period) {
  return payPeriodFor(addDays(period.to, 1), period.frequency);
}

// Reads ?freq=&period=YYYY-MM-DD (any day in the period) or a custom
// ?from=&to=. Custom ranges are capped at 62 days.
export function resolvePayPeriod(params = {}, now = new Date()) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const from = one(params.from);
  const to = one(params.to);
  if (isIsoDate(from) && isIsoDate(to) && from <= to) {
    const capped = addDays(from, 61) < to ? addDays(from, 61) : to;
    return { from, to: capped, frequency: 'custom' };
  }
  const freq = PAY_FREQUENCIES[one(params.freq)] ? one(params.freq) : 'semimonthly';
  return payPeriodFor(one(params.period) || todayIso(now), freq);
}

export function periodLabel({ from, to }) {
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${m}/${d}/${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

// "9:00 AM" -> minutes after midnight.
function labelMinutes(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function spanMinutes(startLabel, endLabel) {
  const a = labelMinutes(startLabel);
  const b = labelMinutes(endLabel);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + 1440 - a; // past midnight
}

export function scheduledMinutes(visit) {
  return spanMinutes(visit?.start, visit?.end);
}

// Clock-in to clock-out: the captured timestamps when both exist (they are
// the authoritative values), else the display labels (older visits).
export function workedMinutes(visit) {
  const e = visit?.evv;
  if (!e) return null;
  if (e.clockInAt && e.clockOutAt) {
    const ms = new Date(e.clockOutAt).getTime() - new Date(e.clockInAt).getTime();
    return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
  }
  return spanMinutes(e.clockIn, e.clockOut);
}

export function billMinutes(visit) {
  return visit?.billMinutes || scheduledMinutes(visit);
}

export const LINE_STATES = {
  verified: { label: 'Verified', tone: 'success' },
  exception: { label: 'Open EVV exception', tone: 'danger', fix: 'Resolve it in visit maintenance before payroll.' },
  in_progress: { label: 'Clocked in, never clocked out', tone: 'danger', fix: 'Add the clock-out in visit maintenance.' },
  not_clocked: { label: 'No clock-in or clock-out', tone: 'danger', fix: 'Record the visit in visit maintenance, or mark it missed.' },
  bad_times: { label: 'Clock times look wrong', tone: 'danger', fix: 'Check the clock-in and clock-out in visit maintenance.' },
  missed: { label: 'Missed', tone: 'muted' },
  upcoming: { label: 'Not happened yet', tone: 'muted' },
};

export function lineState(visit, today = todayIso()) {
  if (visit.status === 'missed') return 'missed';
  if (visit.status === 'in-progress') return 'in_progress';
  if (visit.status === 'scheduled') return visit.serviceDate > today ? 'upcoming' : 'not_clocked';
  if (visit.status === 'completed') {
    const worked = workedMinutes(visit);
    if (worked === null || worked <= 0 || worked > 24 * 60) return 'bad_times';
    if (!visit.resolved || !visit.evv?.verified) return 'exception';
    return 'verified';
  }
  return 'not_clocked';
}

export const hours = (minutes) => Math.round(((minutes || 0) / 60) * 100) / 100;
export const fmtHours = (minutes) => hours(minutes).toFixed(2);

// The authorization a visit falls under: the one picked at scheduling, else
// the client's approved authorization covering the service date.
export function authorizationFor(visit, auths = []) {
  if (visit.serviceAuthorizationId) {
    const picked = auths.find((a) => a.id === visit.serviceAuthorizationId);
    if (picked) return picked;
  }
  const iso = (d) => (d ? String(d).slice(0, 10) : null);
  return (
    auths.find(
      (a) =>
        a.clientId === visit.clientId &&
        a.status === 'approved' &&
        (!iso(a.startDate) || iso(a.startDate) <= visit.serviceDate) &&
        (!iso(a.endDate) || iso(a.endDate) >= visit.serviceDate)
    ) || null
  );
}

// "S5125 U5" / "S5125" + "U5" -> { code: 'S5125', modifiers: 'U5' }
function splitCode(auth) {
  const parts = String(auth?.serviceCode || '').trim().split(/\s+/).filter(Boolean);
  const code = parts.shift() || '';
  const modifiers = [...parts, ...String(auth?.modifierCodes || '').split(/[\s,:;]+/)].filter(Boolean);
  return { code, modifiers: [...new Set(modifiers)].join(' ') };
}

// rows: [{ visit, caregiverName, caregiverRole, clientName }] for the whole
// span of the workweeks the period touches (so the 40-hour check sees a
// full week even when a twice-a-month period splits it).
export function buildPayrollReport({ rows = [], auths = [], period, today = todayIso() }) {
  const inPeriod = (r) => r.visit.serviceDate >= period.from && r.visit.serviceDate <= period.to;
  const byCaregiver = new Map();
  const weekHours = new Map(); // caregiverId -> Map(monday -> verified minutes)

  for (const r of rows) {
    const v = r.visit;
    const state = lineState(v, today);
    const worked = state === 'verified' ? workedMinutes(v) : null;
    if (worked) {
      const weeks = weekHours.get(v.caregiverId) || new Map();
      const mon = mondayOf(v.serviceDate);
      weeks.set(mon, (weeks.get(mon) || 0) + worked);
      weekHours.set(v.caregiverId, weeks);
    }
    if (!inPeriod(r)) continue;
    const { code, modifiers } = splitCode(authorizationFor(v, auths));
    const line = {
      visitId: v.id,
      serviceDate: v.serviceDate,
      start: v.start,
      end: v.end,
      clockIn: v.evv?.clockIn || null,
      clockOut: v.evv?.clockOut || null,
      clientId: v.clientId,
      clientName: r.clientName || '',
      serviceCode: code,
      modifiers,
      state,
      scheduledMinutes: scheduledMinutes(v),
      verifiedMinutes: worked,
      billMinutes: state === 'verified' ? billMinutes(v) : null,
      adjusted: Boolean(v.billMinutes),
    };
    const entry = byCaregiver.get(v.caregiverId) || {
      caregiverId: v.caregiverId,
      name: r.caregiverName || 'Unknown attendant',
      role: r.caregiverRole || '',
      lines: [],
    };
    entry.lines.push(line);
    byCaregiver.set(v.caregiverId, entry);
  }

  const attendants = [...byCaregiver.values()].map((a) => {
    a.lines.sort((x, y) => x.serviceDate.localeCompare(y.serviceDate) || (labelMinutes(x.start) ?? 0) - (labelMinutes(y.start) ?? 0));
    const verified = a.lines.filter((l) => l.state === 'verified');
    const sum = (list, k) => list.reduce((n, l) => n + (l[k] || 0), 0);
    const totals = {
      visits: verified.length,
      scheduledMinutes: sum(verified, 'scheduledMinutes'),
      verifiedMinutes: sum(verified, 'verifiedMinutes'),
      billMinutes: sum(verified, 'billMinutes'),
    };
    totals.varianceMinutes = totals.verifiedMinutes - totals.scheduledMinutes;
    const attention = a.lines.filter((l) => LINE_STATES[l.state].fix);
    const weeks = [...(weekHours.get(a.caregiverId) || new Map()).entries()]
      .filter(([mon]) => addDays(mon, 6) >= period.from && mon <= period.to)
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([monday, minutes]) => ({
        monday,
        sunday: addDays(monday, 6),
        minutes,
        overtimeMinutes: Math.max(0, minutes - OVERTIME_THRESHOLD_HOURS * 60),
        partial: monday < period.from || addDays(monday, 6) > period.to,
      }));
    return { ...a, totals, attention, weeks, overtime: weeks.some((w) => w.overtimeMinutes > 0) };
  });
  attendants.sort((x, y) => x.name.localeCompare(y.name));

  const all = attendants.flatMap((a) => a.lines);
  const summary = {
    attendants: attendants.length,
    verifiedVisits: all.filter((l) => l.state === 'verified').length,
    verifiedMinutes: attendants.reduce((n, a) => n + a.totals.verifiedMinutes, 0),
    scheduledMinutes: attendants.reduce((n, a) => n + a.totals.scheduledMinutes, 0),
    needsAttention: all.filter((l) => LINE_STATES[l.state].fix).length,
    overtimeAttendants: attendants.filter((a) => a.overtime).length,
  };
  summary.varianceMinutes = summary.verifiedMinutes - summary.scheduledMinutes;
  return { period, attendants, summary };
}

// --- CSV ---------------------------------------------------------------
// One row per verified visit, plus a total row per attendant. Minimum
// necessary for payroll: no Medicaid ID, diagnosis or address.
export const CSV_COLUMNS = [
  'Attendant ID', 'Attendant', 'Visit ID', 'Service date', 'Scheduled start', 'Scheduled end',
  'Clock in', 'Clock out', 'Bill code', 'Modifiers', 'Client', 'Scheduled hrs', 'Verified hrs', 'Bill hrs', 'Variance hrs',
];

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Stop a spreadsheet from treating a text cell as a formula (numbers such
  // as a negative variance are left alone).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function payrollCsv(report) {
  const out = [CSV_COLUMNS];
  for (const a of report.attendants) {
    for (const l of a.lines.filter((x) => x.state === 'verified')) {
      out.push([
        a.caregiverId, a.name, l.visitId, l.serviceDate, l.start, l.end, l.clockIn, l.clockOut,
        l.serviceCode, l.modifiers, l.clientName,
        fmtHours(l.scheduledMinutes), fmtHours(l.verifiedMinutes), fmtHours(l.billMinutes),
        fmtHours(l.verifiedMinutes - l.scheduledMinutes),
      ]);
    }
    if (a.totals.visits) {
      out.push([
        a.caregiverId, `${a.name} — TOTAL`, '', '', '', '', '', '', '', '', `${a.totals.visits} visit(s)`,
        fmtHours(a.totals.scheduledMinutes), fmtHours(a.totals.verifiedMinutes), fmtHours(a.totals.billMinutes),
        fmtHours(a.totals.varianceMinutes),
      ]);
    }
  }
  return out.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
