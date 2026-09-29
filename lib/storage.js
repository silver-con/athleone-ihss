// File storage for incoming faxes and uploads (PHI).
//
//   STORAGE_DRIVER=local (default, and the only driver today) — files under
//     STORAGE_DIR (default ./storage, git-ignored). Right for your Mac and for
//     the Docker setup, where docker-compose.yml mounts a volume there.
//
// The Google Cloud Storage driver was removed on 2026-09-28 ahead of the
// move to Azure; Azure Blob Storage will be added here as a second driver.
// Any other STORAGE_DRIVER value is refused rather than silently writing PHI
// to a disk that may be wiped on restart.
//
// Keys look like <organizationId>/incoming/<documentId>.pdf and are built
// by the app, never taken from user input.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
export const STORAGE_DRIVERS = ['local'];

export function storageConfig(env = process.env) {
  const requested = (env.STORAGE_DRIVER || 'local').toLowerCase();
  return {
    driver: STORAGE_DRIVERS.includes(requested) ? requested : null,
    requested,
    dir: path.resolve(/* turbopackIgnore: true */ env.STORAGE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'storage')),
  };
}

function checkKey(key) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Bad storage key: ${key}`);
}

function localDir(env) {
  const cfg = storageConfig(env);
  if (!cfg.driver) throw new Error(`STORAGE_DRIVER=${cfg.requested} is not available (only: ${STORAGE_DRIVERS.join(', ')}).`);
  return cfg.dir;
}

export async function putFile(key, buffer, contentType, { env = process.env } = {}) {
  checkKey(key);
  const full = path.join(/* turbopackIgnore: true */ localDir(env), key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, buffer, { mode: 0o600 });
}

export async function getFile(key, { env = process.env } = {}) {
  checkKey(key);
  return readFile(path.join(/* turbopackIgnore: true */ localDir(env), key));
}
