// Google Document AI reading engine (REST, no SDK).
// https://cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process
//
// Works with any processor type:
//   - Custom Extractor (recommended): returns named entities (client_name,
//     date_of_birth, medicaid_id, …; see lib/docai/fields.js) with confidence;
//   - Form Parser: returns key/value pairs, mapped by their printed labels;
//   - Document OCR: returns text, mapped by labels (lib/docai/parse.js).
import { getGoogleAuthHeaders } from '@/lib/google-auth';

export function googleDocaiConfig(env = process.env) {
  const project = env.GOOGLE_CLOUD_PROJECT || env.DOCAI_PROJECT_ID || null;
  const location = (env.DOCAI_LOCATION || 'us').toLowerCase();
  const processorId = env.DOCAI_PROCESSOR_ID || null;
  const version = env.DOCAI_PROCESSOR_VERSION || null;
  const missing = [];
  if (!project) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!processorId) missing.push('DOCAI_PROCESSOR_ID');
  return { project, location, processorId, version, missing };
}

// Google's document.text has no page breaks; each page says which part of
// the text is on it. Rebuild the text with form feeds between pages, so the
// reader knows page 1 is a fax cover sheet (and shows the right page).
export function pagedText(doc) {
  const text = doc?.text || '';
  const pages = doc?.pages || [];
  if (pages.length < 2 || !pages.every((p) => p.layout?.textAnchor?.textSegments?.length)) return text;
  return pages
    .map((p) => p.layout.textAnchor.textSegments.map((seg) => text.slice(Number(seg.startIndex || 0), Number(seg.endIndex || 0))).join(''))
    .join('\f');
}

// The useful part of a Google error: field violations, reasons, hints.
export function googleErrorDetail(json) {
  const out = [];
  for (const d of json?.error?.details || []) {
    for (const v of d.fieldViolations || []) out.push(`${v.field ? v.field + ': ' : ''}${v.description || ''}`.trim());
    if (d.reason) out.push(d.reason + (d.metadata ? ' ' + Object.entries(d.metadata).map(([k, v]) => `${k}=${v}`).join(' ') : ''));
    if (d.detail) out.push(d.detail);
  }
  return [...new Set(out.filter(Boolean))].join('; ').slice(0, 400);
}

export function processUrl(cfg) {
  const base = `https://${cfg.location}-documentai.googleapis.com/v1/projects/${encodeURIComponent(cfg.project)}/locations/${cfg.location}/processors/${encodeURIComponent(cfg.processorId)}`;
  return cfg.version ? `${base}/processorVersions/${encodeURIComponent(cfg.version)}:process` : `${base}:process`;
}

export async function extractWithGoogle(buffer, mimeType, { fetchImpl = fetch, env = process.env } = {}) {
  const cfg = googleDocaiConfig(env);
  if (cfg.missing.length) {
    const err = new Error(`Google Document AI isn't fully configured — missing ${cfg.missing.join(', ')}.`);
    err.userFacing = true;
    throw err;
  }
  const auth = await getGoogleAuthHeaders({ fetchImpl, env });
  const call = (withMask) =>
    fetchImpl(processUrl(cfg), {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        rawDocument: { content: Buffer.from(buffer).toString('base64'), mimeType },
        // Skip the page images in the response (we already have the file).
        ...(withMask ? { fieldMask: 'text,entities,pages.pageNumber,pages.formFields,pages.layout' } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    });
  let res = await call(true);
  let json = await res.json().catch(() => ({}));
  if (res.status === 400) {
    // Some processor types (e.g. Custom Extractor) reject the field mask with
    // a plain "invalid argument" — ask again for the whole document.
    res = await call(false);
    json = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const detail = googleErrorDetail(json);
    // Google's error names the setting or problem; it never contains document text.
    console.error(`[docai] Google Document AI HTTP ${res.status}: ${msg}${detail ? ` (${detail})` : ''}`);
    const err = new Error(`Google Document AI couldn't read the document: ${msg}${detail ? ` — ${detail}` : ''}`);
    err.userFacing = true;
    err.status = res.status;
    throw err;
  }
  const doc = json.document || {};
  return {
    engine: 'google-docai',
    text: pagedText(doc),
    pageCount: (doc.pages || []).length || null,
    entities: doc.entities || [],
    document: doc,
  };
}
