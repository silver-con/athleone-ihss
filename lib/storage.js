// File storage for incoming faxes and uploads (PHI). Two drivers:
//
//   STORAGE_DRIVER=local (default) — files under STORAGE_DIR (default
//     ./storage, git-ignored). Right for your Mac and for the Docker /
//     DigitalOcean setup, where docker-compose.yml mounts a volume there.
//   STORAGE_DRIVER=gcs — a private Google Cloud Storage bucket (GCS_BUCKET).
//     Required on Cloud Run, whose disk is wiped on every restart. Uses the
//     same Google identity as Document AI (lib/google-auth.js).
//
// Keys look like <organizationId>/incoming/<documentId>.pdf and are built
// by the app, never taken from user input.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getGoogleAccessToken } from '@/lib/google-auth';

const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function storageConfig(env = process.env) {
  const driver = (env.STORAGE_DRIVER || 'local').toLowerCase() === 'gcs' ? 'gcs' : 'local';
  return {
    driver,
    dir: path.resolve(/* turbopackIgnore: true */ env.STORAGE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'storage')),
    bucket: env.GCS_BUCKET || null,
  };
}

function checkKey(key) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Bad storage key: ${key}`);
}

export async function putFile(key, buffer, contentType, { fetchImpl = fetch, env = process.env } = {}) {
  checkKey(key);
  const cfg = storageConfig(env);
  if (cfg.driver === 'gcs') {
    if (!cfg.bucket) throw new Error('STORAGE_DRIVER=gcs needs GCS_BUCKET.');
    const token = await getGoogleAccessToken({ fetchImpl, env });
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(key)}`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType || 'application/octet-stream' },
      body: buffer,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Cloud Storage upload failed (HTTP ${res.status}) ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const full = path.join(/* turbopackIgnore: true */ cfg.dir, key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, buffer, { mode: 0o600 });
}

export async function getFile(key, { fetchImpl = fetch, env = process.env } = {}) {
  checkKey(key);
  const cfg = storageConfig(env);
  if (cfg.driver === 'gcs') {
    if (!cfg.bucket) throw new Error('STORAGE_DRIVER=gcs needs GCS_BUCKET.');
    const token = await getGoogleAccessToken({ fetchImpl, env });
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o/${encodeURIComponent(key)}?alt=media`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Cloud Storage download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(/* turbopackIgnore: true */ cfg.dir, key));
}
