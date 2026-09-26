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

const ALL_LABELS = new Set(FIELDS.flatMap((f) => f.labels).concat(['service code', 'diagnosis', 'member', 'services', 'provider name', 'provider phone', 'pcp fax', 'provider fax', 'provider email address', 'template', 'notes', 'priority']));

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

// "Client Name", "client-name", "Referral/client_name" -> "client_name"
export function normalizeEntityType(type) {
  const last = String(type || '').split('/').pop();
  return last
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Custom Extractor may nest fields under a parent entity (`properties`).
export function flattenEntities(entities = []) {
  const out = [];
  const walk = (list) => {
    for (const e of list || []) {
      out.push(e);
      if (e.properties?.length) walk(e.properties);
    }
  };
  walk(entities);
  return out;
}

function entityValue(ent) {
  const d = ent.normalizedValue?.dateValue;
  if (d?.year && d?.month && d?.day) return `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')}/${d.year}`;
  return clean(ent.normalizedValue?.text || ent.mentionText);
}

// Which field names Google returned, and whether Athleone used each one
// (shown on the review screen so a schema-name mismatch is obvious).
export function entitySummary(entities = []) {
  const seen = new Map();
  for (const ent of flattenEntities(entities)) {
    const name = normalizeEntityType(ent.type);
    if (!name) continue;
    const def = FIELDS.find((f) => f.entity.includes(name));
    const row = seen.get(name) || { name, field: def?.key || null, withValue: false };
    if (entityValue(ent)) row.withValue = true;
    seen.set(name, row);
  }
  return [...seen.values()];
}

export function fieldsFromEntities(entities = []) {
  const out = {};
  for (const ent of flattenEntities(entities)) {
    const type = normalizeEntityType(ent.type);
    const def = FIELDS.find((f) => f.entity.includes(type));
    if (!def) continue;
    const value = entityValue(ent);
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

// What a value for each field must look like when it's read from printed
// labels (column layouts put headers where values should be). Returns the
// cleaned value, or null to keep looking.
const MONTH_DATE = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}`;
const HEADER_WORDS = /^(total|frequency|modifier|line status|decision|status|standard|unit|units|week|code|qualifier|period|priority|notes?|template|diagnosis (?:qualifier|code|description)|service (?:code|description)|description)\b/i;
export function checkTextValue(key, v) {
  v = clean(v);
  if (!v) return null;
  if (['dob', 'authStart', 'authEnd'].includes(key)) {
    const m = new RegExp(`${DATE}|${MONTH_DATE}`, 'i').exec(v);
    return m ? m[0] : null;
  }
  if (key === 'serviceCode') {
    const m = /[A-Z$]\s?\d{4}(?:\s+[A-Z0-9]{2}\b)?/.exec(v);
    return m ? m[0] : null;
  }
  if (key === 'phone') {
    const m = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(v);
    return m ? m[0] : null;
  }
  if (key === 'medicaidId') return /\d{3}[\s-]?\d{3}[\s-]?\d{3}/.test(v) ? v : null;
  if (key === 'authHours') return /\d/.test(v) && !HEADER_WORDS.test(v) ? v : null;
  if (['unitsPerWeek', 'totalUnits'].includes(key)) {
    const m = /\d[\d,]*(?:\.\d+)?/.exec(v);
    return m && !/^(total|frequency|unit)/i.test(v) ? m[0] : null;
  }
  if (key === 'reviewDate') {
    const m = new RegExp(`${DATE}|${MONTH_DATE}`, 'i').exec(v);
    return m ? m[0] : null;
  }
  if (key === 'coordinatorPhone' || key === 'pcpPhone') {
    const m = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/i.exec(v);
    return m ? m[0] : null;
  }
  if (key === 'coordinatorEmail') {
    const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(v.replace(/\s+/g, ''));
    return m ? m[0] : null;
  }
  if (key === 'diagnosisCode') {
    const m = /\b[A-TV-Z]\d{2}(?:\.?[A-Z0-9]{1,4})?\b/i.exec(v);
    return m ? m[0] : null;
  }
  if (key === 'modifier') {
    const m = /^[A-Z0-9]{2}(?:\s*[,\s]\s*[A-Z0-9]{2})*$/i.exec(v);
    return m ? v : null;
  }
  if (key === 'authStatus') return /(approv|pend|den|partial|review|cancel)/i.test(v) ? v : null;
  if ((key === 'coordinatorName' || key === 'pcpName') && /^(phone|email|fax|name)\b/i.test(v)) return null;
  if (key === 'authNumber') return /\d/.test(v) && !HEADER_WORDS.test(v) ? v : null;
  if (HEADER_WORDS.test(v)) return null;
  if (key === 'payer') {
    const known = KNOWN_PAYERS.some(([needle]) => v.toLowerCase().includes(needle.toLowerCase()));
    if (!known && !/\b(plan|health|healthcare|medicaid|medicare|insurance|star|chip|hhsc|mco)\b/i.test(v)) return null;
  }
  if (['clientName', 'service', 'diagnosis', 'payer', 'address'].includes(key) && !/[a-z]{3}/i.test(v)) return null;
  if (['service', 'diagnosis'].includes(key) && !/[a-z]{4}/i.test(v)) return null;
  return v;
}

// A fax cover sheet on page 1 carries the SENDER's phone, name and address,
// not the client's — skip it when reading labels (the letterhead still
// counts for the payer).
function isCoverSheet(pageLines) {
  return pageLines.some((l) => /fax\s*cover\s*sheet|fax\s*coversheet|\bcoversheet\b/i.test(l.line.replace(/\s+/g, ' ')));
}

export function fieldsFromText(input, { confidence = 0.85, source = 'text' } = {}) {
  const allLines = Array.isArray(input) ? input : textToLines(input);
  const hasLaterPages = allLines.some((l) => (l.page || 1) > 1);
  const lines = hasLaterPages && isCoverSheet(allLines.filter((l) => (l.page || 1) === 1)) ? allLines.filter((l) => (l.page || 1) > 1) : allLines;
  const out = {};
  const set = (key, value, page, conf = confidence) => {
    if (!value || out[key]) return;
    // "Health Plan ID: 8062…" is an ID, not the plan's name.
    if (key === 'payer' && (/^(id|#|no\.?|number)\b/i.test(value) || !/[a-z]{3}/i.test(value))) return;
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
        // ...but not when that next line is itself another label ("Service Code").
        if (v != null && v === lines[i + 1]?.line && ALL_LABELS.has(clean(v).toLowerCase().replace(/[:#]\s*$/, ''))) v = null;
        if (v != null) v = checkTextValue(f.key, v);
        // An address whose ZIP code wrapped onto the next line.
        if (v && f.key === 'address' && /\b[A-Z]\s?[A-Z]$/.test(v)) {
          const after = lines[v === lines[i + 1]?.line ? i + 2 : i + 1]?.line || '';
          if (/^\d{5}(-\d{4})?$/.test(after)) v = `${v} ${after}`;
        }
        // A task list that wraps onto the following lines.
        if (v && f.key === 'approvedTasks') {
          let k = v === lines[i + 1]?.line ? i + 2 : i + 1;
          while (lines[k] && !/:/.test(lines[k].line) && (/,\s*$/.test(v) || /,/.test(lines[k].line)) && v.length < 800) {
            v = `${v} ${lines[k].line}`;
            k++;
          }
        }
        if (v) {
          set(f.key, v, page, conf);
          if (out[f.key]) break;
        }
      }
    }
  }

  // Hours written in a sentence: "29 hrs on a 7 day plan", "18 hours per week".
  if (!out.authHours) {
    for (const { line, page } of lines) {
      const m = /\b(\d{1,3}(?:\.\d+)?)\s*(?:hrs?|hours)\b[^.]{0,30}?(?:per\s*week|\/\s*w(?:ee)?k|a\s*week|weekly|7[\s-]*day)/i.exec(line);
      if (m) {
        out.authHours = { value: `${m[1]} hrs/wk`, confidence: Math.min(confidence, 0.6), page, source };
        break;
      }
    }
  }
  // Diagnosis table: an ICD-10 code followed by its description, near a "Diagnosis" heading.
  if (!out.diagnosis) {
    for (let i = 0; i < lines.length; i++) {
      if (!/diagnosis/i.test(lines[i].line)) continue;
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        const m = /(?:^|\s)([A-TV-Z]\d{2}(?:\.\d{1,4})?)\s+([A-Z][A-Z ,'/-]{4,}?)(?:\s+(?:principal|primary|secondary))?$/i.exec(lines[j].line);
        if (m && /[A-Z]{4}/.test(m[2])) {
          out.diagnosis = { value: `${m[2].trim()} (${m[1].toUpperCase()})`, confidence: Math.min(confidence, 0.6), page: lines[j].page, source };
          break;
        }
      }
      if (out.diagnosis) break;
    }
  }

  // Payer from the letterhead when nothing was labelled.
  if (!out.payer) {
    const joined = allLines.slice(0, 12).map((l) => l.line).join(' \n ');
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
    else if (k === 'serviceCode') v = v.replace(/^\$(?=\s?\d{4}\b)/, 'S').replace(/^S\s(\d{4})/, 'S$1');
    else if (k === 'medicaidId') v = /^[\d\s-]+$/.test(v) ? v.replace(/[\s-]/g, '') : v;
    else if (k === 'authHours') v = normalizeHours(v);
    else if (k === 'phone' || k === 'coordinatorPhone' || k === 'pcpPhone') v = normalizePhone(v);
    else if (k === 'reviewDate') v = normalizeDate(v);
    else if (k === 'unitsPerWeek' || k === 'totalUnits') v = (/[\d,.]+/.exec(v)?.[0] || v).replace(/,/g, '');
    else if (k === 'modifier') v = v.toUpperCase().replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ');
    else if (k === 'diagnosisCode') v = v.toUpperCase().replace(/\s+/g, '');
    else if (k === 'authStatus') v = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    else if (k === 'coordinatorEmail') v = v.replace(/\s+/g, '');
    else if (k === 'approvedTasks') v = v.replace(/\s*,\s*/g, ', ').replace(/[.;]\s*$/, '');
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
