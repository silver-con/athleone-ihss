// Real-calendar helpers for the schedule (added 2026-09-24). Replaces the
// fixed demo week (WEEK_DAYS / TODAY_ISO, 2026-09-14..20) that used to live
// in lib/data.js. Pure functions, no imports, safe in server and client
// components. Every date is an ISO 'YYYY-MM-DD' string in the agency's
// time zone (America/Chicago) — the same form visits.service_date uses —
// so there is never a JS Date/time-zone shift in between.

export const AGENCY_TIME_ZONE = 'America/Chicago';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Today's date where the agency is.
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function toUtc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return fromUtc(toUtc(iso) + days * 86400000);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86400000);
}

// 0 = Monday … 6 = Sunday.
function weekdayIndex(iso) {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export function dayKeyForIso(iso) {
  return isIsoDate(iso) ? DAY_KEYS[weekdayIndex(iso)] : null;
}

export function mondayOf(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

// The 7 days (Mon–Sun) of the week starting on `mondayIso`, in the same
// shape the old WEEK_DAYS constant had, so pages change as little as
// possible: { key, label, date: 'M/D', iso }.
export function getWeek(mondayIso) {
  return DAY_KEYS.map((key, i) => {
    const iso = addDays(mondayIso, i);
    const [, m, d] = iso.split('-').map(Number);
    return { key, label: DAY_LABELS[i], date: `${m}/${d}`, iso };
  });
}

// Reads a `?week=YYYY-MM-DD` search param (any day in the week is fine)
// and returns that week's Monday; falls back to the current week.
export function resolveWeekStart(param, now = new Date()) {
  const value = Array.isArray(param) ? param[0] : param;
  return mondayOf(isIsoDate(value) ? value : todayIso(now));
}

export function isInWeek(iso, mondayIso) {
  if (!isIsoDate(iso)) return false;
  const offset = daysBetween(mondayIso, iso);
  return offset >= 0 && offset <= 6;
}

// "Tue 9/22" — for a visit's date anywhere in the UI.
export function shortDayLabel(iso) {
  if (!isIsoDate(iso)) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${DAY_LABELS[weekdayIndex(iso)]} ${m}/${d}`;
}

// "Sep 21 – 27, 2026" / "Sep 28 – Oct 4, 2026"
export function weekRangeLabel(mondayIso) {
  const sunday = addDays(mondayIso, 6);
  const fmt = (iso, opts) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(toUtc(iso)));
  const sameMonth = mondayIso.slice(0, 7) === sunday.slice(0, 7);
  return `${fmt(mondayIso, { month: 'short', day: 'numeric' })} – ${fmt(sunday, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${sunday.slice(0, 4)}`;
}
