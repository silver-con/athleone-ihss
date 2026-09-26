// Fax / document intake pipeline: store the file, read it, save what was
// found for a person to review. No next/* imports (QA drives it directly).
//
//   ingestDocument  -> validates and stores the file, creates the inbox row
//   processDocument -> runs the reading engine, saves fields or the error
import { createHash, randomUUID } from 'node:crypto';
import * as db from '@/lib/queries';
import { putFile, getFile } from '@/lib/storage';
import { readDocument, ACCEPTED_TYPES, MAX_BYTES } from '@/lib/docai';

// Decide the type from the file's first bytes, not the name or what the
// browser/fax provider claims.
export function sniffMimeType(buf) {
  const b = Buffer.from(buf.subarray(0, 12));
  if (b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'image/tiff';
  if (b.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function safeName(name) {
  return String(name || 'document').replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
}

// Returns { ok: true, id, duplicateOf? } or { ok: false, error }.
export async function ingestDocument({ organizationId, buffer, fileName, source, sender = null, userId = null }) {
  if (!buffer || !buffer.length) return { ok: false, error: 'The file is empty.' };
  if (buffer.length > MAX_BYTES) return { ok: false, error: 'The file is larger than 20 MB.' };
  const mimeType = sniffMimeType(buffer);
  if (!mimeType || !ACCEPTED_TYPES[mimeType]) return { ok: false, error: 'Send a PDF, TIFF, PNG or JPEG.' };

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const existing = await db.findIncomingDocumentBySha(organizationId, sha256);
  if (existing) return { ok: true, id: existing.id, duplicateOf: existing.id };

  const id = randomUUID();
  const fileKey = `${organizationId}/incoming/${id}.${ACCEPTED_TYPES[mimeType]}`;
  await putFile(fileKey, buffer, mimeType);
  await db.createIncomingDocument(organizationId, {
    id,
    source,
    fileKey,
    fileName: safeName(fileName),
    mimeType,
    fileSize: buffer.length,
    sha256,
    sender,
    uploadedByUserId: userId,
  });
  return { ok: true, id };
}

// Reads the stored file and saves the extracted fields (status
// needs_review) or the error (status failed). Never throws.
export async function processDocument(organizationId, id, opts = {}) {
  const doc = await db.getIncomingDocument(organizationId, id);
  if (!doc || !['received', 'failed'].includes(doc.status)) return { ok: false, error: 'Nothing to process.' };
  await db.markIncomingDocumentProcessing(organizationId, id);
  try {
    const buffer = await getFile(doc.fileKey);
    const result = await readDocument(buffer, doc.mimeType, opts);
    await db.saveIncomingDocumentExtraction(organizationId, id, result);
    return { ok: true };
  } catch (err) {
    const message = err?.userFacing ? err.message : 'The document could not be read. Try again, or enter the referral by hand.';
    if (!err?.userFacing) console.error(`[intake] reading document ${id} failed:`, err);
    await db.markIncomingDocumentFailed(organizationId, id, message);
    return { ok: false, error: message };
  }
}
