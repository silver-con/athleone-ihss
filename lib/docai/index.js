// Reading an incoming document: run the configured engine, turn its output
// into referral fields, tidy them. Chosen with DOCAI_PROVIDER:
//   demo (default) — reads typed PDFs locally, no account, no cost
//                    (lib/docai/demo.js)
//
// Google Document AI was removed on 2026-09-28 ahead of the move to Azure.
// A new engine is one module plus one line in ENGINES. It returns
//   { engine, text, pageCount, entities?, document? }
// where `entities` are named fields ({ type, mentionText, confidence,
// properties? }) using the names in lib/docai/fields.js (`entity`), and
// `text` separates pages with a form feed (\f) so the cover sheet is skipped.
import { extractWithDemo } from './demo.js';
import { checkMedicaidProvenance, fieldsFromEntities, entitySummary, fieldsFromText, formFieldLines, textToLines, mergeFields, normalizeFields, classifyDocument } from './parse.js';
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

const ENGINES = {
  demo: { extract: extractWithDemo, label: 'Demo mode — reads typed PDFs only' },
};

// Readable names for the engine stored on a document (older documents may
// say google-docai: they were read before Google was removed).
export const ENGINE_NAMES = { demo: 'demo mode', 'google-docai': 'Google Document AI' };
export function engineName(engine) {
  return ENGINE_NAMES[engine] || engine || 'unknown reader';
}

export function docaiStatus(env = process.env) {
  const requested = (env.DOCAI_PROVIDER || 'demo').toLowerCase();
  const provider = ENGINES[requested] ? requested : 'demo';
  return {
    provider,
    requested,
    unsupported: requested !== provider,
    live: provider !== 'demo',
    label: ENGINES[provider].label,
    missing: [],
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
  // opts.extract: tests (and a future engine under trial) can supply their own.
  const extract = opts.extract || ENGINES[status.provider].extract;
  const raw = await extract(buffer, mimeType, opts);
  // The engine's own text is what entity positions point into.
  const fromEntities = checkMedicaidProvenance(fieldsFromEntities(raw.entities), raw.document?.text || raw.text);
  const fromForm = raw.document ? fieldsFromText(formFieldLines(raw.document), { source: 'form' }) : {};
  const fromText = fieldsFromText(textToLines(raw.text), { confidence: raw.engine === 'demo' ? 0.85 : 0.7 });
  const fields = normalizeFields(mergeFields(fromEntities, mergeFields(fromForm, fromText)));
  // Which named fields the engine returned (demo mode has none to report).
  const entityTypes = raw.engine !== 'demo' && Array.isArray(raw.entities) ? entitySummary(raw.entities) : null;
  const docType = classifyDocument(raw.text);
  const serviceLines = buildServiceLines({ fields, entities: raw.entities, text: raw.text, lineStatus: lineStatusFromText(raw.text) });
  return { engine: raw.engine, text: raw.text, pageCount: raw.pageCount, docType, documentType: documentTypeFromClassifier(docType), fields, entityTypes, serviceLines, primaryLine: 0 };
}
