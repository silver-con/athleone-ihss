// Encryption for third-party credentials stored in the database.
//
// Each tenant's HHAeXchange client id and secret are encrypted at rest with
// AES-256-GCM. GCM is authenticated, so a tampered ciphertext fails to
// decrypt rather than silently returning garbage that we'd then send to the
// state aggregator.
//
// The key comes from EVV_CREDENTIALS_KEY (64 hex characters = 32 bytes) and
// must be managed as a real secret in whatever environment this runs in —
// see the compliance handoff brief. Rotating it invalidates every stored
// credential, which is the correct behavior: the agencies re-enter them.
//
// Nothing in this module ever logs plaintext, and decrypted values must
// never be returned to the browser — only server-side code calls decrypt().
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the standard size for GCM

function getKey() {
  const raw = process.env.EVV_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'EVV_CREDENTIALS_KEY is not set. Generate one with: openssl rand -hex 32'
    );
  }
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== 32) {
    throw new Error('EVV_CREDENTIALS_KEY must be 64 hex characters (32 bytes).');
  }
  return key;
}

// Returns "iv:authTag:ciphertext", all base64 — a single text column value.
export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const [ivB64, tagB64, dataB64] = String(stored).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored credential is malformed.');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// For UI display — shows enough to recognize which credential is stored
// without revealing it.
export function maskSecret(value) {
  if (!value) return '—';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}
