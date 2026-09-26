// Reading an incoming document: run the configured engine, turn its output
// into referral fields, tidy them. Chosen with DOCAI_PROVIDER:
//   demo   (default) — reads typed PDFs locally, no account (lib/docai/demo.js)
//   google — Google Document AI (lib/docai/google.js); reads scans and photos
import { extractWithDemo } from './demo.js';
import { extractWithGoogle, googleDocaiConfig } from '@/lib/docai/google';
import { checkMedicaidProvenance, fieldsFromEntities, entitySummary, fieldsFromText, formFieldLines, textToLines, mergeFields, normalizeFields, classifyDocument } from './parse.js';
import { googleCredentialSource } from '@/lib/google-auth';
import { buildServiceLines } from './service-lines.js';
import { documentTypeFromClassifier } from './fields.js';

export const ACCEPTED_TYPES = {
  'application/pdf': 'pdf',
  'image/tiff': 'tif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
export const MAX_BYTES = 20 * 1024 * 1024;

export function docaiStatus(env = process.env) {
  const provider = (env.DOCAI_PROVIDER || 'demo').toLowerCase() === 'google' ? 'google' : 'demo';
  if (provider === 'demo') {
    return { provider, live: false, label: 'Demo mode — reads typed PDFs only', missing: [] };
  }
  const cfg = googleDocaiConfig(env);
  return {
    provider,
    live: cfg.missing.length === 0,
    label: `Google Document AI (${cfg.location})`,
    missing: cfg.missing,
    project: cfg.project,
    processorId: cfg.processorId,
    credentials: googleCredentialSource(env),
  };
}

// "Line Status: Approved" (or the label on one line, the value on the next).
function lineStatusFromText(text) {
  const lines = textToLines(text);
  for (let i = 0; i < lines.length; i++) {
    const m = /^line status\s*[:\-]?\s*(approved|denied|pended|pending|partial\w*|cancel\w*)?\b/i.exec(lines[i].line);
    if (!m) continue;
    if (m[1]) return m[1];
    const next = /^(approved|denied|pended|pending|partial\w*|cancel\w*)\b/i.exec(lines[i + 1]?.line || '');
    if (next) return next[1];
  }
  return null;
}

// Returns { engine, text, pageCount, docType, fields }. Throws on engine
// errors (err.userFacing = safe to show staff).
export async function readDocument(buffer, mimeType, opts = {}) {
  const status = docaiStatus(opts.env);
  const raw = status.provider === 'google' ? await extractWithGoogle(buffer, mimeType, opts) : await extractWithDemo(buffer, mimeType);
  // Google's own text (no page breaks) is what entity positions point into.
  const fromEntities = checkMedicaidProvenance(fieldsFromEntities(raw.entities), raw.document?.text || raw.text);
  const fromForm = raw.document ? fieldsFromText(formFieldLines(raw.document), { source: 'form' }) : {};
  const fromText = fieldsFromText(textToLines(raw.text), { confidence: raw.engine === 'demo' ? 0.85 : 0.7 });
  const fields = normalizeFields(mergeFields(fromEntities, mergeFields(fromForm, fromText)));
  const entityTypes = raw.engine === 'google-docai' ? entitySummary(raw.entities) : null;
  const docType = classifyDocument(raw.text);
  const serviceLines = buildServiceLines({ fields, entities: raw.entities, text: raw.text, lineStatus: lineStatusFromText(raw.text) });
  return { engine: raw.engine, text: raw.text, pageCount: raw.pageCount, docType, documentType: documentTypeFromClassifier(docType), fields, entityTypes, serviceLines, primaryLine: 0 };
}
