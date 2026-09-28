// Demo reading engine: reads the text layer of typed PDFs (like the sample
// faxes, or a PDF saved from an e-fax portal) with pdf.js — no account, no
// network, no cost. It cannot read a scanned image; real faxes (which are
// images) need a document-reading service. Google Document AI was removed on
// 2026-09-28; Azure AI Document Intelligence is the planned replacement.
import { getDocumentProxy } from 'unpdf';

// Rebuild lines: group text items by their vertical position, left to right.
async function pdfLines(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => {
        items.sort((a, b) => a.x - b.x);
        // Put a separator where there's a wide gap (label ... value columns).
        let out = '';
        let lastEnd = null;
        for (const it of items) {
          if (lastEnd != null && it.x - lastEnd > 40 && !/[:#]\s*$/.test(out)) out += ': ';
          else if (out) out += ' ';
          out += it.s.trim();
          lastEnd = it.x + it.s.length * 5;
        }
        return out;
      });
    pages.push(lines.join('\n'));
  }
  return { text: pages.join('\f'), pageCount: pdf.numPages };
}

export async function extractWithDemo(buffer, mimeType) {
  if (mimeType !== 'application/pdf') {
    const err = new Error('Demo mode reads typed PDFs only. Scanned faxes and photos need a document-reading service, which isn’t connected yet — enter this one by hand.');
    err.userFacing = true;
    throw err;
  }
  const { text, pageCount } = await pdfLines(buffer);
  if (text.replace(/\s/g, '').length < 20) {
    const err = new Error('This PDF is a scanned image with no text layer. Demo mode can’t read scans, and no document-reading service is connected yet — enter this one by hand.');
    err.userFacing = true;
    throw err;
  }
  return { engine: 'demo', text, pageCount, entities: [], formLines: [] };
}
