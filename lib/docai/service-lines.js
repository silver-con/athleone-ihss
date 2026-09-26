// Service lines: one authorization fax can approve several services (e.g.
// PAS and respite), each with its own code, units, dates and decision.
// The review form shows one staff-selected PRIMARY line in the existing
// single fields; every line is kept in extraction.serviceLines and on the
// referral, so nothing is silently dropped.
//
// A line: { serviceType, serviceCode, modifier, authHours, unitsPerWeek,
//   frequencyPeriod, totalUnits, authStart, authEnd, lineStatus,
//   decisionReason, page, confidence, source }
// Pure functions — QA tests them directly.
import { flattenEntities, normalizeEntityType, normalizeDate, textToLines } from './parse.js';

// Line fields that map straight onto the review form's single fields.
export const LINE_FIELD_KEYS = ['serviceType', 'serviceCode', 'modifier', 'authHours', 'unitsPerWeek', 'frequencyPeriod', 'totalUnits', 'authStart', 'authEnd'];
// line key -> review form field key
export const LINE_TO_FIELD = { serviceType: 'service', serviceCode: 'serviceCode', modifier: 'modifier', authHours: 'authHours', unitsPerWeek: 'unitsPerWeek', frequencyPeriod: 'frequencyPeriod', totalUnits: 'totalUnits', authStart: 'authStart', authEnd: 'authEnd' };

// Google field names for a line's parts (flat fields, or children of a
// `service_line` parent field once the processor has one).
const ENTITY_TO_LINE = {
  service_type: 'serviceType', service_description: 'serviceType', service: 'serviceType',
  procedure_code: 'serviceCode', service_code: 'serviceCode', hcpcs: 'serviceCode', hcpcs_code: 'serviceCode',
  modifier: 'modifier', modifier_1: 'modifier', modifier_code: 'modifier', modifier_code1: 'modifier',
  authorized_hours: 'authHours', hours_per_week: 'authHours', total_hours_per_week: 'authHours',
  units_per_week: 'unitsPerWeek', total_units_per_week: 'unitsPerWeek', frequency: 'unitsPerWeek',
  frequency_period: 'frequencyPeriod', unit_period: 'frequencyPeriod',
  total_units: 'totalUnits', authorized_units: 'totalUnits',
  auth_start_date: 'authStart', start_date: 'authStart', begin_date: 'authStart',
  auth_end_date: 'authEnd', end_date: 'authEnd',
  line_status: 'lineStatus', service_line_status: 'lineStatus',
  decision_reason: 'decisionReason', denial_reason: 'decisionReason',
};

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function entityText(e) {
  const d = e.normalizedValue?.dateValue;
  if (d?.year && d?.month && d?.day) return `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')}/${d.year}`;
  return clean(e.normalizedValue?.text || e.mentionText);
}
const pageOf = (e) => (e.pageAnchor?.pageRefs?.[0]?.page != null ? Number(e.pageAnchor.pageRefs[0].page) + 1 : null);

function tidy(line) {
  const out = {};
  for (const [k, v] of Object.entries(line)) {
    if (v == null || v === '') continue;
    if (k === 'authStart' || k === 'authEnd') out[k] = normalizeDate(String(v));
    else if (k === 'serviceCode') {
      const parts = String(v).toUpperCase().replace(/^\$(?=\d{4})/, 'S').split(/\s+/);
      out.serviceCode = parts[0];
      if (parts[1] && /^[A-Z0-9]{2}$/.test(parts[1]) && !line.modifier) out.modifier = parts[1];
    } else if (k === 'modifier') out[k] = String(v).toUpperCase().replace(/\s*,\s*/g, ' ');
    else if (k === 'unitsPerWeek' || k === 'totalUnits') out[k] = (/[\d,.]+/.exec(String(v))?.[0] || String(v)).replace(/,/g, '');
    else if (k === 'lineStatus') out[k] = String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase();
    else out[k] = typeof v === 'string' ? clean(v) : v;
  }
  return out;
}

const hasContent = (l) => Boolean(l.serviceCode || l.serviceType || l.unitsPerWeek || l.authHours || l.authStart);
const sameLine = (a, b) =>
  (a.serviceCode || '') === (b.serviceCode || '') && (a.authStart || '') === (b.authStart || '') && (a.authEnd || '') === (b.authEnd || '') && (a.modifier || '') === (b.modifier || '');

// Lines from Google entities: `service_line` parents (one line each), and any
// line field Google returned more than once (the 2nd value -> line 2, ...).
export function linesFromEntities(entities = []) {
  const parents = [];
  const repeats = {};
  for (const e of entities || []) {
    const type = normalizeEntityType(e.type);
    if (type === 'service_line' || type === 'service_lines' || type === 'line_item') {
      const line = { source: 'engine', page: pageOf(e), confidence: typeof e.confidence === 'number' ? e.confidence : null };
      for (const p of flattenEntities(e.properties || [])) {
        const key = ENTITY_TO_LINE[normalizeEntityType(p.type)];
        if (key && !line[key]) line[key] = entityText(p);
      }
      parents.push(tidy(line));
    }
  }
  for (const e of flattenEntities(entities).filter((x) => !['service_line', 'service_lines', 'line_item'].includes(normalizeEntityType(x.type)))) {
    const key = ENTITY_TO_LINE[normalizeEntityType(e.type)];
    if (!key) continue;
    (repeats[key] ||= []).push({ value: entityText(e), page: pageOf(e) });
  }
  const extra = [];
  const count = Math.max(0, ...Object.values(repeats).map((v) => v.length));
  for (let i = 1; i < count; i++) {
    const line = { source: 'engine-repeat' };
    for (const [key, vals] of Object.entries(repeats)) if (vals[i]) line[key] = vals[i].value;
    extra.push(tidy(line));
  }
  // The first value of each field is line 1 (it's also in the single fields).
  const first = { source: 'engine' };
  for (const [key, vals] of Object.entries(repeats)) if (vals[0]) first[key] = vals[0].value;
  return { parents, first: tidy(first), extra };
}

// Rows of a service-code table in the text, e.g. Molina's
// "S5125 ATTENDANT CARE SERVICES; PER 15 MINUTES 2,555 116 Unit Week U5 09/01/2026 09/30/2027 Approved".
export function linesFromTable(text) {
  const out = [];
  for (const { line, page } of textToLines(text)) {
    const m = /^\$?([A-Z]\d{4})\b(.*)$/.exec(line.replace(/^\$(?=\d{4})/, 'S'));
    if (!m) continue;
    const rest = m[2];
    const dates = rest.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    const status = /\b(approved|denied|pended|pending|partial(?:ly approved)?|cancel(?:l)?ed)\b/i.exec(rest)?.[1];
    if (!dates.length && !status) continue;
    const beforeDates = rest.split(/\d{1,2}\/\d{1,2}\/\d{4}/)[0];
    const modifier = /\b(U[1-9A-D]|T[FGT]|H[AQ-W]|G[TW]|UA|UB|UC|UD|TD|TE|TT|HQ)\b/.exec(beforeDates)?.[1];
    const nums = (beforeDates.replace(/\bPER\s+\d+\s+MINUTES?\b/i, '').match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g) || []).map((n) => n.replace(/,/g, ''));
    const period = /\b(week|day|month)\b/i.exec(beforeDates)?.[1];
    const serviceType = clean(beforeDates.replace(/\b\d[\d,.]*\b/g, ' ').replace(/\b(unit|units|week|day|month|U[1-9A-D]|T[FGT])\b/gi, ' ').replace(/[;]\s*$/, ''));
    out.push(
      tidy({
        source: 'table',
        page,
        serviceCode: m[1],
        modifier,
        serviceType: serviceType || null,
        // Molina: Total Units, then Frequency (units per period)
        totalUnits: nums.length >= 2 ? nums[0] : null,
        unitsPerWeek: nums.length >= 2 ? nums[1] : nums[0] || null,
        frequencyPeriod: period ? period.charAt(0).toUpperCase() + period.slice(1).toLowerCase() : null,
        authStart: dates[0],
        authEnd: dates[1],
        lineStatus: status,
      })
    );
  }
  return out;
}

// All the lines for a document. Line 0 is built from the single fields
// (what the review form shows by default); others are added only when they
// differ from it.
export function buildServiceLines({ fields = {}, entities = [], text = '', lineStatus = null } = {}) {
  const v = (k) => fields[k]?.value || null;
  const fromEntities = linesFromEntities(entities);
  const base = tidy({
    source: 'fields',
    serviceType: v('service'),
    serviceCode: v('serviceCode'),
    modifier: v('modifier'),
    authHours: v('authHours'),
    unitsPerWeek: v('unitsPerWeek'),
    frequencyPeriod: v('frequencyPeriod'),
    totalUnits: v('totalUnits'),
    authStart: v('authStart'),
    authEnd: v('authEnd'),
    lineStatus: lineStatus || fromEntities.first.lineStatus || null,
    decisionReason: fromEntities.first.decisionReason || null,
  });
  const lines = [];
  const add = (l) => {
    if (!hasContent(l)) return;
    const i = lines.findIndex((x) => sameLine(x, l) || (!x.serviceCode && !x.authStart && l.serviceCode && x.serviceType && l.serviceType === x.serviceType));
    if (i === -1) lines.push(l);
    else for (const [k, val] of Object.entries(l)) if (lines[i][k] == null && val != null) lines[i][k] = val; // fill gaps only
  };
  // A table row that matches line 0 fills its gaps (e.g. the line status).
  const table = linesFromTable(text);
  if (fromEntities.parents.length) fromEntities.parents.forEach(add);
  else add(base);
  for (const l of [...fromEntities.extra, ...table]) add(l);
  if (!lines.length && hasContent(base)) lines.push(base);
  return lines;
}

// The review form's single fields for a chosen line.
export function fieldsForLine(line = {}) {
  const out = {};
  for (const [lk, fk] of Object.entries(LINE_TO_FIELD)) out[fk] = line[lk] || '';
  return out;
}
