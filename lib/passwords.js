// Password policy and temporary-password generation. Pure functions (no
// DB), shared by every place that sets a password: team accounts, caregiver
// logins, a new agency's first admin, platform admins, and the
// change-password page.
//
// Policy follows NIST SP 800-63B rather than composition rules: length is
// what matters, so require 10+ characters, cap at 128 (bcrypt only reads
// the first 72 bytes, and a huge input is a cheap DoS), and reject the
// handful of choices that are obviously guessable for this app.
import { randomInt } from 'crypto';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  '1234567890', '0123456789', '12345678910', 'qwertyuiop', 'qwerty1234',
  'letmein123', 'welcome123', 'iloveyou12', 'abc1234567', 'changeme123',
  'hearth1234', 'hearthcare', 'caregiver1', 'caregiver123', 'homecare123',
  'medicaid123', 'texas12345', 'admin12345', 'administrator',
]);

// Returns null when acceptable, or a staff-readable reason when not.
export function passwordProblem(password, { email, name } = {}) {
  const pw = String(password || '');
  if (pw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common — choose something less guessable.';
  if (/^(.)\1+$/.test(pw)) return 'That password is a single repeated character.';
  const local = String(email || '').toLowerCase().split('@')[0];
  if (local.length >= 4 && lower.includes(local)) return "Don't include your email address in your password.";
  const first = String(name || '').toLowerCase().split(/\s+/)[0];
  if (first.length >= 4 && lower.includes(first)) return "Don't include your name in your password.";
  return null;
}

// A temporary password an admin reads out or sends to someone once. No
// look-alike characters (0/O, 1/l/I) so it survives being read aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateTemporaryPassword(length = 14) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  // Grouped for readability: Xk7p-Rm2q-9Tbw-Hn
  return out.match(/.{1,4}/g).join('-');
}
