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

export function validateFields(fields, { today = new Date(), checkConfidence = true } = {}) {
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
  return issues;
}

export function hasBlockingIssues(issues) {
  return Object.values(issues || {}).some((list) => list.some((i) => i.level === 'error'));
}
