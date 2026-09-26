// Reading an incoming document: run the configured engine, turn its output
// into referral fields, tidy them. Chosen with DOCAI_PROVIDER:
//   demo   (default) — reads typed PDFs locally, no account (lib/docai/demo.js)
//   google — Google Document AI (lib/docai/google.js); reads scans and photos
import { extractWithDemo } from './demo.js';
import { extractWithGoogle, googleDocaiConfig } from '@/lib/docai/google';
import { fieldsFromEntities, entitySummary, fieldsFromText, formFieldLines, textToLines, mergeFields, normalizeFields, classifyDocument } from './parse.js';
import { googleCredentialSource } from '@/lib/google-auth';

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

// Returns { engine, text, pageCount, docType, fields }. Throws on engine
// errors (err.userFacing = safe to show staff).
export async function readDocument(buffer, mimeType, opts = {}) {
  const status = docaiStatus(opts.env);
  const raw = status.provider === 'google' ? await extractWithGoogle(buffer, mimeType, opts) : await extractWithDemo(buffer, mimeType);
  const fromEntities = fieldsFromEntities(raw.entities);
  const fromForm = raw.document ? fieldsFromText(formFieldLines(raw.document), { source: 'form' }) : {};
  const fromText = fieldsFromText(textToLines(raw.text), { confidence: raw.engine === 'demo' ? 0.85 : 0.7 });
  const fields = normalizeFields(mergeFields(fromEntities, mergeFields(fromForm, fromText)));
  const entityTypes = raw.engine === 'google-docai' ? entitySummary(raw.entities) : null;
  return { engine: raw.engine, text: raw.text, pageCount: raw.pageCount, docType: classifyDocument(raw.text), fields, entityTypes };
}
