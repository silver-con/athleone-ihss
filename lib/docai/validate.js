// Checks on extracted (or reviewer-edited) referral fields. Pure — the
// duplicate checks that need the database live in lib/queries.js.
// Returns { [fieldKey]: [{ level: 'error' | 'warn', message }] }.
//   error = must be fixed before approving; warn = look twice.
import { FIELDS } from './fields.js';

export const LOW_CONFIDENCE = 0.7;

function parseUsDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? d : null;
}

// NPI check digit (Luhn over "80840" + the first 9 digits).
export function validNpi(npi) {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ('80840' + npi.slice(0, 9)).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = digits[i];
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

const STOP = new Set(['llc', 'inc', 'the', 'of', 'and', 'home', 'care', 'health', 'healthcare', 'services', 'service', 'agency', 'co', 'corp', 'ltd']);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

// `agency`: { name, npi } of the agency reviewing — to catch a fax meant for someone else.
export function validateFields(fields, { today = new Date(), checkConfidence = true, agency = null } = {}) {
  const issues = {};
  const add = (k, level, message) => (issues[k] ||= []).push({ level, message });
  const val = (k) => String(fields?.[k]?.value ?? '').trim();

  for (const f of FIELDS) {
    if (f.required && !val(f.key)) add(f.key, 'error', `${f.label} is required.`);
    const c = fields?.[f.key]?.confidence;
    if (checkConfidence && val(f.key) && typeof c === 'number' && c < LOW_CONFIDENCE && fields[f.key].source !== 'reviewer') {
      add(f.key, 'warn', 'The reader wasn’t sure about this — check it against the fax.');
    }
  }

  if (val('dob')) {
    const d = parseUsDate(val('dob'));
    if (!d) add('dob', 'error', 'Date of birth must be a real date, MM/DD/YYYY.');
    else if (d > today || d.getUTCFullYear() < 1900) add('dob', 'error', 'Date of birth is outside 1900–today.');
    else if (today.getUTCFullYear() - d.getUTCFullYear() < 18) add('dob', 'warn', 'This makes the client a child — check the year against the fax.');
  }
  if (val('medicaidId')) {
    if (!/^\d{9}$/.test(val('medicaidId'))) add('medicaidId', 'error', 'A Texas Medicaid ID is 9 digits.');
  } else {
    add('medicaidId', 'warn', 'No Medicaid ID — the client can be added, but EVV visits can’t be sent to the state until it’s entered.');
  }
  for (const k of ['authStart', 'authEnd']) {
    if (val(k) && !parseUsDate(val(k))) add(k, 'error', 'Use a real date, MM/DD/YYYY.');
  }
  const s = parseUsDate(val('authStart'));
  const e = parseUsDate(val('authEnd'));
  if (s && e && e < s) add('authEnd', 'error', 'The authorization ends before it starts.');
  if (e && e < today) add('authEnd', 'warn', 'This authorization has already expired.');
  if (val('authHours') && !/\d/.test(val('authHours'))) add('authHours', 'error', 'Hours must include a number (e.g. 18 hrs/wk). If the plan hasn’t set them yet, ask before approving.');
  if (val('serviceCode') && !/^[A-Z]\d{4}(\s+[A-Z0-9]{2})*$/.test(val('serviceCode'))) {
    add('serviceCode', 'warn', 'Doesn’t look like a HCPCS code (e.g. S5125 U5).');
  }
  // Authorization detail
  const status = val('authStatus');
  if (/den|reject|cancel/i.test(status)) add('authStatus', 'error', 'The payer did not approve this authorization. Don’t create a referral from it — reject the fax, or call the payer.');
  else if (/pend|review|partial/i.test(status)) add('authStatus', 'warn', 'Not fully approved yet — the care plan will be created as Pending.');
  const num = (k) => {
    const m = /\d[\d,]*(?:\.\d+)?/.exec(val(k));
    return m ? Number(m[0].replace(/,/g, '')) : null;
  };
  const hours = num('authHours');
  const units = num('unitsPerWeek');
  if (hours != null && units != null && Math.abs(units - hours * 4) > 1) {
    add('unitsPerWeek', 'warn', `${units} units/week is ${units / 4} hours at 15-minute units, but the hours say ${hours}. Check which is right.`);
  }
  const total = num('totalUnits');
  if (total != null && units != null && s && e) {
    const weeks = (e - s) / (7 * 86400000) + 1 / 7;
    const expected = Math.round(units * weeks);
    if (expected > 0 && Math.abs(total - expected) / expected > 0.05) {
      add('totalUnits', 'warn', `${units} units/week over these dates is about ${expected.toLocaleString('en-US')} units, not ${total.toLocaleString('en-US')}. Confirm the total with the payer before billing against it.`);
    }
  }
  if (val('diagnosisCode') && !/^[A-TV-Z]\d{2}(\.?[A-Z0-9]{1,4})?$/.test(val('diagnosisCode'))) add('diagnosisCode', 'warn', 'Doesn’t look like an ICD-10 code (e.g. I10, E11.9).');
  if (val('modifier') && !/^[A-Z0-9]{2}( [A-Z0-9]{2})*$/.test(val('modifier'))) add('modifier', 'warn', 'Modifiers are 2 characters each (e.g. U5).');
  if (val('coordinatorEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('coordinatorEmail'))) add('coordinatorEmail', 'warn', 'Doesn’t look like an email address.');
  if (val('reviewDate') && !parseUsDate(val('reviewDate'))) add('reviewDate', 'warn', 'Use MM/DD/YYYY.');
  for (const k of ['referralDate', 'dischargeDate']) if (val(k) && !parseUsDate(val(k))) add(k, 'warn', 'Use MM/DD/YYYY.');
  if (val('providerNpi') && !validNpi(val('providerNpi'))) add('providerNpi', 'warn', 'This isn’t a valid NPI (10 digits with a check digit) — it may have been misread.');
  if (agency?.npi && val('providerNpi') && validNpi(val('providerNpi')) && val('providerNpi') !== String(agency.npi).replace(/\D/g, '')) {
    add('providerNpi', 'warn', `This fax is addressed to NPI ${val('providerNpi')}, but your agency’s NPI is ${agency.npi}. Check it’s meant for you.`);
  }
  if (agency?.name && val('servicingProvider')) {
    const mine = words(agency.name);
    const theirs = words(val('servicingProvider'));
    if (mine.length && theirs.length && !theirs.some((w) => mine.includes(w))) {
      add('servicingProvider', 'warn', `The servicing provider on the fax isn’t ${agency.name}. It may have been sent to the wrong agency — check before approving.`);
    }
  }
  const dd = parseUsDate(val('dischargeDate'));
  if (dd && s && s < dd) add('authStart', 'warn', 'The authorization starts before the discharge date — check the dates.');
  return issues;
}

export function hasBlockingIssues(issues) {
  return Object.values(issues || {}).some((list) => list.some((i) => i.level === 'error'));
}
