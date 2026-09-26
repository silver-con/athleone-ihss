// Turns what a reading engine returned into Athleone's referral fields.
// Pure functions (no I/O) so QA can test them directly.
//
//   fieldsFromEntities(entities)  Google Custom Extractor entities -> fields
//   fieldsFromText(text)          labelled lines ("Member Name: …") -> fields
//   mergeFields(primary, backup)  keep the better value per field
//   normalizeFields(fields)       tidy values (dates, IDs, hours, names)
//
// A field is { value, confidence (0..1), page (1-based or null), source }.
import { FIELDS, DATE_RANGE_LABELS, KNOWN_PAYERS } from './fields.js';

const DATE = String.raw`(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})`;

function clean(s) {
  return String(s ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// --- from Google Document AI entities ---------------------------------------

export function fieldsFromEntities(entities = []) {
  const out = {};
  for (const ent of entities) {
    const type = String(ent.type || '').toLowerCase();
    const def = FIELDS.find((f) => f.entity.includes(type));
    if (!def) continue;
    const value = clean(ent.normalizedValue?.text || ent.mentionText);
    if (!value) continue;
    const page = ent.pageAnchor?.pageRefs?.[0]?.page != null ? Number(ent.pageAnchor.pageRefs[0].page) + 1 : null;
    const confidence = typeof ent.confidence === 'number' ? ent.confidence : 0.8;
    if (!out[def.key] || out[def.key].confidence < confidence) {
      out[def.key] = { value, confidence, page, source: 'engine' };
    }
  }
  return out;
}

// --- from Google Form Parser key/value pairs --------------------------------

function anchorText(fullText, anchor) {
  const segs = anchor?.textSegments || [];
  return clean(segs.map((s) => fullText.slice(Number(s.startIndex || 0), Number(s.endIndex || 0))).join(' '));
}

// document.pages[].formFields -> "Label: value" lines, fed to fieldsFromText.
export function formFieldLines(document) {
  const text = document?.text || '';
  const lines = [];
  for (const page of document?.pages || []) {
    for (const ff of page.formFields || []) {
      const k = anchorText(text, ff.fieldName?.textAnchor).replace(/:\s*$/, '');
      const v = anchorText(text, ff.fieldValue?.textAnchor);
      if (k && v) lines.push({ line: `${k}: ${v}`, page: (page.pageNumber || 1), confidence: ff.fieldValue?.confidence ?? 0.8 });
    }
  }
  return lines;
}

// --- from plain text ---------------------------------------------------------

// `text` may contain form feeds (\f) between pages.
export function textToLines(text) {
  const out = [];
  String(text || '')
    .split('\f')
    .forEach((pageText, i) => {
      for (const raw of pageText.split(/\r?\n/)) {
        const line = clean(raw);
        if (line) out.push({ line, page: i + 1 });
      }
    });
  return out;
}

function matchLabel(line, label, { allowHash = true } = {}) {
  // "Label: value", "Label # value", "Label value" (only when the label is
  // multi-word, to avoid "Name" matching "Named in…"). Names never use "#"
  // ("Member #: 123" is a number, not a member name).
  const sep = allowHash ? '[:#.]' : '[:.]';
  const re = new RegExp(`^${escapeRe(label)}\\s*(?:${sep}|\\s-\\s)\\s*(.+)$`, 'i');
  const m = re.exec(line);
  if (m) return clean(m[1]);
  if (label.includes(' ')) {
    const loose = new RegExp(`^${escapeRe(label)}\\s+(.+)$`, 'i');
    const n = loose.exec(line);
    if (n) return clean(n[1]);
  }
  return null;
}

export function fieldsFromText(input, { confidence = 0.85, source = 'text' } = {}) {
  const lines = Array.isArray(input) ? input : textToLines(input);
  const out = {};
  const set = (key, value, page, conf = confidence) => {
    if (!value || out[key]) return;
    out[key] = { value, confidence: conf, page, source };
  };

  for (let i = 0; i < lines.length; i++) {
    const { line, page } = lines[i];
    const conf = lines[i].confidence ?? confidence;
    // A date range on one line: "Effective Dates: 10/01/2026 - 03/31/2027"
    for (const label of DATE_RANGE_LABELS) {
      const v = matchLabel(line, label);
      if (!v) continue;
      const m = new RegExp(`${DATE}\\s*(?:-|–|to|through|thru)\\s*${DATE}`, 'i').exec(v);
      if (m) {
        set('authStart', m[1], page, conf);
        set('authEnd', m[2], page, conf);
      }
      break;
    }
    for (const f of FIELDS) {
      if (out[f.key]) continue;
      for (const label of f.labels) {
        let v = matchLabel(line, label, { allowHash: f.key !== 'clientName' });
        if (v && f.key === 'clientName' && !/[a-z]{2}/i.test(v)) v = null; // a name has letters
        // Label alone on its line, value on the next ("Member Name" / "Rosa…")
        if (v == null && new RegExp(`^${escapeRe(label)}\\s*:?$`, 'i').test(line) && lines[i + 1]) v = lines[i + 1].line;
        if (v) {
          set(f.key, v, page, conf);
          break;
        }
      }
    }
  }

  // Payer from the letterhead when nothing was labelled.
  if (!out.payer) {
    const joined = lines.slice(0, 12).map((l) => l.line).join(' \n ');
    for (const [needle, name] of KNOWN_PAYERS) {
      if (joined.toLowerCase().includes(needle.toLowerCase())) {
        out.payer = { value: name, confidence: 0.6, page: 1, source: 'letterhead' };
        break;
      }
    }
  }
  // A 9-digit Medicaid ID near the word Medicaid, if no label matched.
  if (!out.medicaidId) {
    for (const { line, page } of lines) {
      if (!/medicaid/i.test(line)) continue;
      const m = /(\d{3}[\s-]?\d{3}[\s-]?\d{3})(?!\d)/.exec(line);
      if (m) {
        out.medicaidId = { value: m[1], confidence: 0.55, page, source };
        break;
      }
    }
  }
  return out;
}

// Keep each field from `primary` unless it's missing or less confident.
export function mergeFields(primary = {}, backup = {}) {
  const out = { ...backup };
  for (const [k, v] of Object.entries(primary)) {
    if (!out[k] || (v && v.value && v.confidence >= (out[k].confidence ?? 0))) out[k] = v;
  }
  return out;
}

// --- normalising values ------------------------------------------------------

// `past`: the date can't be in the future (a birth date), so a two-digit
// year that would land in the future belongs to the 1900s ("04/12/41").
export function normalizeDate(raw, { past = false, now = new Date() } = {}) {
  const s = clean(raw);
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += past ? (2000 + y > now.getFullYear() ? 1900 : 2000) : y > 30 ? 1900 : 2000;
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${y}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(s);
  if (/[a-z]/i.test(s) && !Number.isNaN(d.getTime())) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  }
  return s;
}

export function normalizeName(raw) {
  let s = clean(raw);
  const m = /^([A-Za-z'’-]+),\s*(.+)$/.exec(s); // "BROOKS, LIONEL J" -> "LIONEL J BROOKS"
  if (m) s = `${m[2]} ${m[1]}`;
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return s;
}

export function normalizeHours(raw) {
  const s = clean(raw);
  const m = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)?\s*(?:\/|per|a)?\s*(wk|week|weekly|day|daily|month|mo)?/i.exec(s);
  if (!m || !/\d/.test(s)) return s;
  const unit = (m[2] || '').toLowerCase();
  const per = unit.startsWith('d') ? 'day' : unit.startsWith('mo') ? 'month' : unit ? 'wk' : null;
  return per ? `${m[1]} hrs/${per}` : s;
}

export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length >= 10) {
    const rest = clean(String(raw).replace(/^[\s(]*\d{3}[)\s.-]*\d{3}[\s.-]*\d{4}/, ''));
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6, 10)}${rest ? ' ' + rest : ''}`;
  }
  return clean(raw);
}

export function normalizeFields(fields) {
  const out = {};
  for (const [k, f] of Object.entries(fields || {})) {
    if (!f || !clean(f.value)) continue;
    let v = clean(f.value);
    if (k === 'dob') v = normalizeDate(v, { past: true });
    else if (k === 'authStart' || k === 'authEnd') v = normalizeDate(v);
    else if (k === 'clientName') v = normalizeName(v);
    else if (k === 'medicaidId') v = /^[\d\s-]+$/.test(v) ? v.replace(/[\s-]/g, '') : v;
    else if (k === 'authHours') v = normalizeHours(v);
    else if (k === 'phone') v = normalizePhone(v);
    else if (k === 'serviceCode') v = v.toUpperCase();
    out[k] = { ...f, value: v };
  }
  return out;
}

// What kind of document this looks like — shown in the inbox.
export function classifyDocument(text) {
  const t = String(text || '').toLowerCase();
  if (/service authori[sz]ation|authori[sz]ation notification|prior authori[sz]ation/.test(t)) return 'authorization';
  if (/discharge/.test(t)) return 'discharge referral';
  if (/referral/.test(t)) return 'referral';
  if (/physician order|plan of care|485/.test(t)) return 'physician order';
  return 'other';
}
