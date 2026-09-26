// The fields Athleone pulls out of an incoming referral / authorization
// fax, and how to find each one. Shared by every reading engine.
//
// `entity`: names to give the fields in a Google Document AI Custom
//   Extractor (the first name is the one the setup guide tells you to use;
//   the rest are accepted too).
// `labels`: printed labels to look for in the document text ("Member Name:",
//   "DOB", …), longest/most specific first. Used when the engine returns
//   plain text (demo mode, Google's OCR/Form Parser) or misses a field.
// `required`: needed before the referral can be created.
export const FIELDS = [
  { key: 'clientName', label: 'Client name', required: true, entity: ['client_name', 'member_name', 'patient_name'], labels: ['member name', 'patient name', 'client name', 'patient', 'member', 'name'] },
  { key: 'dob', label: 'Date of birth', required: true, entity: ['date_of_birth', 'dob', 'birth_date'], labels: ['date of birth', 'birth date', 'dob'] },
  { key: 'medicaidId', label: 'Medicaid ID', entity: ['medicaid_id', 'member_id'], labels: ['member id (medicaid)', 'medicaid id', 'medicaid number', 'medicaid #', 'medicaid no', 'member id'] },
  { key: 'payer', label: 'Payer / health plan', required: true, entity: ['payer_name', 'health_plan', 'payer', 'insurance'], labels: ['health plan', 'insurance', 'payer', 'plan'] },
  { key: 'authNumber', label: 'Authorization #', required: true, entity: ['authorization_number', 'auth_number', 'referral_number'], labels: ['referral / auth no.', 'authorization number', 'authorization #', 'authorization no', 'auth number', 'auth no.', 'auth #', 'referral number', 'referral #'] },
  { key: 'service', label: 'Service', required: true, entity: ['service_type', 'service', 'program'], labels: ['services requested', 'program / service', 'service type', 'service', 'program'] },
  { key: 'serviceCode', label: 'Procedure code', entity: ['procedure_code', 'service_code', 'hcpcs'], labels: ['procedure code', 'service code', 'hcpcs', 'cpt'] },
  { key: 'authHours', label: 'Authorized hours', required: true, entity: ['authorized_hours', 'hours', 'units'], labels: ['authorized hours', 'hours per week', 'units', 'hours'] },
  { key: 'authStart', label: 'Authorization start', entity: ['auth_start_date', 'start_date', 'effective_start'], labels: ['start date'] },
  { key: 'authEnd', label: 'Authorization end', entity: ['auth_end_date', 'end_date', 'effective_end'], labels: ['end date'] },
  { key: 'diagnosis', label: 'Diagnosis / reason', required: true, entity: ['diagnosis', 'primary_diagnosis', 'reason'], labels: ['primary diagnosis', 'primary dx', 'diagnosis', 'reason', 'dx'] },
  { key: 'address', label: 'Client address', entity: ['client_address', 'member_address', 'address'], labels: ['member address', 'patient address', 'client address', 'address'] },
  { key: 'phone', label: 'Client phone', entity: ['client_phone', 'member_phone', 'phone'], labels: ['member phone', 'patient phone', 'client phone', 'phone'] },
];

// A date range printed as one field ("Effective Dates: 10/01/2026 - 03/31/2027").
export const DATE_RANGE_LABELS = ['effective dates', 'authorization period', 'start - end', 'service dates', 'effective', 'dates'];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Texas Medicaid managed-care plans and common referral sources, used to
// recognise the payer from a letterhead when there's no "Plan:" label.
export const KNOWN_PAYERS = [
  ['Molina', 'Molina Healthcare'],
  ['Superior HealthPlan', 'Superior HealthPlan'],
  ['Superior Health', 'Superior HealthPlan'],
  ['Amerigroup', 'Amerigroup'],
  ['Wellpoint', 'Wellpoint'],
  ['UnitedHealthcare', 'UnitedHealthcare Community Plan'],
  ['United Healthcare', 'UnitedHealthcare Community Plan'],
  ['Aetna Better Health', 'Aetna Better Health'],
  ['Blue Cross', 'Blue Cross Blue Shield of Texas'],
  ['BCBSTX', 'Blue Cross Blue Shield of Texas'],
  ['Cigna', 'Cigna'],
  ['Community First', 'Community First Health Plans'],
  ['Community Health Choice', 'Community Health Choice'],
  ['Cook Children', "Cook Children's Health Plan"],
  ['Driscoll', 'Driscoll Health Plan'],
  ['El Paso Health', 'El Paso Health'],
  ['Parkland', 'Parkland Community Health Plan'],
  ['Texas Children', "Texas Children's Health Plan"],
  ['Sendero', 'Sendero Health Plans'],
  ['Anthem', 'Anthem Blue Cross'],
];
