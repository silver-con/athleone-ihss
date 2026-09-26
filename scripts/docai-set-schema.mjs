#!/usr/bin/env node
// Sets all 40 Athleone fields on your Document AI Custom Extractor in one go
// (instead of typing them into the console one by one).
//
//   node docai-set-schema.mjs            -> shows what it will do (changes nothing)
//   node docai-set-schema.mjs --apply    -> saves the fields to the processor
//
// Uses your gcloud login (gcloud auth application-default login / gcloud auth login).
// Saves a backup of the current schema next to this file before changing anything.
// It sends only field names and descriptions — no documents, no patient data.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'athleone';
const LOCATION = process.env.DOCAI_LOCATION || 'us';
const PROCESSOR = process.env.DOCAI_PROCESSOR_ID || 'e29a4b3013c6545b';
const APPLY = process.argv.includes('--apply');

// name, type (string | datetime | number), description
const FIELDS = [
  ['client_name', 'string', "Member / patient / client full name (e.g. Member Name). Not the sender, provider agency or coordinator."],
  ['date_of_birth', 'datetime', 'Member date of birth (Member DOB)'],
  ['medicaid_id', 'string', 'Texas Medicaid ID, 9 digits; may be labelled Member ID or Health Plan ID'],
  ['payer_name', 'string', 'Health plan / payer, e.g. Molina Healthcare, Superior HealthPlan, Amerigroup (often only in the letterhead)'],
  ['authorization_number', 'string', 'Authorization / referral / prior-auth number (e.g. Reference#, Auth #)'],
  ['service_type', 'string', 'Service authorized, e.g. Non-Waiver PAS Agency Model, Personal Attendant Services'],
  ['procedure_code', 'string', 'HCPCS service code, e.g. S5125'],
  ['authorized_hours', 'string', 'Authorized HOURS per week, e.g. 29 hours per week (not units)'],
  ['auth_start_date', 'datetime', 'First day the authorization is effective (Start Date / Begin Date)'],
  ['auth_end_date', 'datetime', 'Last day the authorization is effective (End Date)'],
  ['diagnosis', 'string', 'Diagnosis description or reason for services'],
  ['client_address', 'string', "Member home address including city, state and ZIP"],
  ['client_phone', 'string', "Member phone number (not the payer's, coordinator's or provider's)"],
  ['auth_status', 'string', 'Authorization / line status, e.g. Approved, Pended, Denied'],
  ['case_id', 'string', 'Payer case ID, e.g. LTSS-########'],
  ['modifier', 'string', 'Service code modifier, e.g. U5 (Modifier 1)'],
  ['units_per_week', 'number', 'Authorized 15-minute units per week (Frequency / Total Units Per Week)'],
  ['total_units', 'number', 'Total units authorized for the whole authorization period'],
  ['review_date', 'datetime', 'Date the payer reviewed / decided the authorization'],
  ['diagnosis_code', 'string', 'ICD-10 diagnosis code, e.g. I10'],
  ['approved_tasks', 'string', 'Approved / purchased tasks list, e.g. bathing, dressing, meal prep'],
  ['service_coordinator_name', 'string', "Payer's service coordinator for the member"],
  ['service_coordinator_phone', 'string', 'Service coordinator phone'],
  ['service_coordinator_email', 'string', 'Service coordinator email'],
  ['pcp_name', 'string', 'Primary care physician (PCP) name'],
  ['pcp_phone', 'string', 'Primary care physician phone'],
  ['pcp_fax', 'string', 'Primary care physician fax'],
  ['referral_date', 'datetime', 'Date the referral / service request was made or faxed (Service Request Date)'],
  ['discharge_date', 'datetime', 'Hospital discharge date, if this is a discharge referral'],
  ['servicing_provider', 'string', 'Home-care agency the authorization is for (Servicing Provider / Provider Name)'],
  ['provider_npi', 'string', 'Servicing provider NPI (10 digits); may be labelled Provider NPI/TIN'],
  ['requesting_provider', 'string', 'Requesting / referring provider or referral source'],
  ['program', 'string', 'Medicaid program, e.g. STAR+PLUS, STAR Kids, CLASS, Non-Waiver PAS'],
  ['frequency_period', 'string', 'The period the units are per: Week, Day or Month (Frequency Period)'],
  ['service_days', 'string', 'Service days or schedule, e.g. 7 day plan, Mon-Fri'],
  ['backup_plan', 'string', 'Backup service provider / backup plan, e.g. Informal Support'],
  ['primary_language', 'string', "Member's preferred or primary language"],
  ['emergency_contact_name', 'string', 'Emergency contact or responsible party name'],
  ['emergency_contact_phone', 'string', 'Emergency contact phone'],
  ['emergency_contact_relationship', 'string', 'Emergency contact relationship to the member'],
];

function token() {
  for (const cmd of ['gcloud auth print-access-token', 'gcloud auth application-default print-access-token']) {
    try {
      const t = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (t) return t;
    } catch {}
  }
  console.error('Could not get a Google token. Run: gcloud auth login   (or: gcloud auth application-default login)');
  process.exit(1);
}

const url = `https://${LOCATION}-documentai.googleapis.com/v1beta3/projects/${PROJECT}/locations/${LOCATION}/processors/${PROCESSOR}/dataset/datasetSchema`;
const headers = { Authorization: `Bearer ${token()}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };

const res = await fetch(url, { headers });
const current = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Couldn't read the processor's schema (HTTP ${res.status}): ${current?.error?.message || ''}`);
  console.error('Check: project', PROJECT, '· region', LOCATION, '· processor', PROCESSOR, '· your account has Document AI Editor/Admin.');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const backup = path.join(here, `docai-schema-backup-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(current, null, 2));

const schema = current.documentSchema || {};
const types = schema.entityTypes || [];
// The document-level entity type holds the fields (Custom Extractor makes one).
let root = types.find((t) => (t.baseTypes || []).includes('document')) || types[0];
if (!root) {
  root = { name: 'custom_extraction_document_type', baseTypes: ['document'], properties: [] };
  types.push(root);
}
// Copy the settings of an existing field (e.g. your "test" field) so the
// format matches exactly what this processor uses.
const template = (root.properties || [])[0] || {};
const existing = new Map((root.properties || []).map((p) => [p.name, p]));
const props = FIELDS.map(([name, valueType, description]) => ({
  ...(existing.get(name) || {}),
  ...(template.method ? { method: template.method } : {}),
  name,
  displayName: name,
  description,
  valueType,
  occurrenceType: 'OPTIONAL_ONCE',
}));
const dropped = (root.properties || []).filter((p) => !FIELDS.some(([n]) => n === p.name)).map((p) => p.name);
root.properties = props;
schema.entityTypes = types;

console.log(`Processor ${PROCESSOR} (${PROJECT}, ${LOCATION}) — entity type "${root.name}"`);
console.log(`Backup of the current schema: ${backup}`);
console.log(`Fields to set (${props.length}): ${props.map((p) => p.name).join(', ')}`);
if (dropped.length) console.log(`Fields that will be removed: ${dropped.join(', ')}`);
if (!APPLY) {
  console.log('\nNothing changed yet. Run again with --apply to save these fields.');
  process.exit(0);
}

const up = await fetch(`${url}?updateMask=document_schema`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ name: current.name, documentSchema: schema }),
});
const out = await up.json().catch(() => ({}));
if (!up.ok) {
  console.error(`Google refused the schema (HTTP ${up.status}): ${out?.error?.message || ''}`);
  for (const d of out?.error?.details || []) for (const v of d.fieldViolations || []) console.error(` - ${v.field}: ${v.description}`);
  console.error('Nothing was changed. Send this message to Claude.');
  process.exit(1);
}
// Some API versions return a long-running operation; either way it's accepted.
console.log('\nSaved. Refresh the processor\'s "Get started" page in the console to see the fields.');
console.log('Next: Label & Build -> Call foundation model -> create a version, then Deploy & use -> Deploy -> Set as default.');
