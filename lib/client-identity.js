// Normalizers/validators for the EVV identity fields on a client and the
// provider identifiers on an agency's EVV credentials. Pure functions, no
// imports — shared by lib/queries.js (writes), lib/evv-mapping.js
// (pre-transmit checks), the client-identity migration, and QA.
//
// Each normalize* returns null for a blank value, the cleaned value for a
// valid one, and throws an Error with a staff-readable message otherwise.
// Blank is allowed at write time on purpose: a referral can arrive without
// a Medicaid ID, and intake shouldn't be blocked on it. The hard stop is at
// transmit time — validateVisitPayload refuses to send a visit for a
// member with no valid Medicaid ID.

function blank(raw) {
  return raw == null || String(raw).trim() === '';
}

// Texas Medicaid ID: 9 digits. Staff often paste it with spaces or dashes.
export function normalizeMedicaidId(raw) {
  if (blank(raw)) return null;
  const digits = String(raw).replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) {
    throw new Error('Medicaid ID must be exactly 9 digits.');
  }
  return digits;
}

export function isValidMedicaidId(value) {
  return typeof value === 'string' && /^\d{9}$/.test(value);
}

// Accepts MM/DD/YYYY (what referrals and people type) or YYYY-MM-DD (what
// <input type="date"> submits). Returns ISO YYYY-MM-DD.
export function normalizeDob(raw, today = new Date()) {
  if (blank(raw)) return null;
  const s = String(raw).trim();
  let y, m, d;
  let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    [, m, d, y] = match.map(Number);
  } else if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [, y, m, d] = match.map(Number);
  } else {
    throw new Error('Date of birth must be a date like 04/18/1941.');
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error('Date of birth is not a real calendar date.');
  }
  if (y < 1900 || dt.getTime() > today.getTime()) {
    throw new Error('Date of birth must be between 1900 and today.');
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatDob(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${m}/${d}/${y}`;
}

export function normalizeState(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) throw new Error('State must be a 2-letter code, e.g. TX.');
  return s;
}

export function normalizeZip(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim();
  if (!/^\d{5}(-\d{4})?$/.test(s)) throw new Error('ZIP must be 5 digits (or ZIP+4, e.g. 78550-1234).');
  return s;
}

export function normalizeText(raw) {
  return blank(raw) ? null : String(raw).trim();
}

// Federal TIN/EIN: 9 digits, often written 12-3456789.
export function normalizeTin(raw) {
  if (blank(raw)) return null;
  return String(raw).replace(/[\s-]/g, '');
}

export function isValidTin(value) {
  return typeof value === 'string' && /^\d{9}$/.test(value);
}

// NPI: 10 digits whose last digit is a Luhn check digit computed over the
// "80840" health-industry prefix plus the first 9 digits (CMS standard).
// 1234567893 is CMS's own published example of a valid NPI.
export function isValidNpi(value) {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return false;
  const digits = ('80840' + value).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let n = digits[i];
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

// HCPCS Level II (letter + 4 digits, e.g. S5125, T1019) or CPT (5 digits).
export function isValidHcpcs(value) {
  return typeof value === 'string' && /^[A-Z0-9]\d{4}$/.test(value);
}

export function isValidModifier(value) {
  return typeof value === 'string' && /^[A-Z0-9]{2}$/.test(value);
}
