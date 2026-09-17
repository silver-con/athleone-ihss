-- Hearth — Postgres schema
--
-- Plain SQL (applied with `psql` or the `db:setup` npm script), read
-- through the `pg` driver from lib/db.js. No ORM — see the README for why.
-- IDs are plain text, generated in application code with
-- crypto.randomUUID() rather than a Postgres extension, so this schema
-- has zero extension/version requirements beyond stock Postgres.
--
-- MULTI-TENANCY: every operational table carries organization_id — one row
-- per licensed home care agency (Hearth's actual customers). Every query in
-- lib/queries.js filters on it explicitly; this schema also enforces it at
-- the database level (NOT NULL + FK) as defense in depth, since a leak here
-- would be a HIPAA breach for whichever agency's data leaked. See the
-- project doc "multitenant-hhaexchange-architecture-spec.md" for the full
-- design rationale.

CREATE TABLE IF NOT EXISTS organizations (
  id                            text PRIMARY KEY,
  name                          text NOT NULL,
  texas_medicaid_provider_number text,
  npi                           text,
  hcssa_license_number          text,
  status                        text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- Caregiver status covers both the hiring pipeline and working state:
-- applicant → onboarding → active, with on-leave and inactive for
-- caregivers already on the roster. A caregiver only becomes 'active'
-- once onboarding (documents + training) is complete — see the project
-- doc "caregiver-onboarding-training-spec.md" §5.
CREATE TABLE IF NOT EXISTS caregivers (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  role            text NOT NULL,
  phone           text NOT NULL,
  email           text,
  hired_on        text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('applicant', 'onboarding', 'active', 'on-leave', 'inactive'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payer           text NOT NULL,
  client_name     text NOT NULL,
  dob             text NOT NULL,
  service         text NOT NULL,
  auth_hours      text NOT NULL,
  auth_number     text NOT NULL,
  diagnosis       text NOT NULL,
  received_date   text NOT NULL,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'completed')),
  fax             jsonb
);

CREATE TABLE IF NOT EXISTS clients (
  id                    text PRIMARY KEY,
  organization_id       text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  payer                 text NOT NULL,
  auth_hours            text NOT NULL,
  auth_hours_num        numeric NOT NULL DEFAULT 0,
  intake_date           text NOT NULL,
  address               text,
  emergency_contact     text,
  care_needs            jsonb NOT NULL DEFAULT '[]',
  assigned_caregiver_id text REFERENCES caregivers(id) ON DELETE SET NULL,
  from_referral_id      text UNIQUE REFERENCES referrals(id) ON DELETE SET NULL,
  -- The individual's HHSC/DADS number as it appears on payer authorizations
  -- and on the Attendant Orientation form required by 26 TAC §97.
  hhsc_individual_number text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visits (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  client_id       text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day             text,
  service_date    text NOT NULL,
  start_time      text NOT NULL,
  end_time        text NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in-progress', 'completed', 'missed')),
  resolved        boolean NOT NULL DEFAULT true,
  vmur_submitted  boolean NOT NULL DEFAULT false,
  evv_clock_in    text,
  evv_clock_out   text,
  evv_method      text,
  evv_verified    boolean NOT NULL DEFAULT false,
  evv_exception   text,
  evv_note        text,
  tasks           jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS messages (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  sender          text NOT NULL,
  body            text NOT NULL,
  time            text NOT NULL,
  mine            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('COORDINATOR', 'ADMIN', 'CAREGIVER')),
  caregiver_id    text UNIQUE REFERENCES caregivers(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- EVV AGGREGATOR INTEGRATION (HHAeXchange)
--
-- Credentials are per tenant, never global: each agency authenticates to
-- the state aggregator with its own OAuth2 client tied to its own Medicaid
-- provider identity. client_id/client_secret are stored encrypted
-- (AES-256-GCM, see lib/secrets.js) and are never returned to the browser
-- or written to logs.
CREATE TABLE IF NOT EXISTS organization_evv_credentials (
  organization_id   text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  api_base_url      text NOT NULL,
  api_version       text NOT NULL DEFAULT '1',
  client_id_enc     text NOT NULL,
  client_secret_enc text NOT NULL,
  scope             text,
  provider_tax_id   text,
  office_qualifier  text DEFAULT 'NPI',
  office_identifier text,
  payer_id          text,
  environment       text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  status            text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'testing', 'passed', 'live', 'disabled')),
  last_success_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per transmission attempt for a visit. This is deliberately
-- separate from the visit itself: a visit can be complete in Hearth and
-- still be unsent, rejected, or awaiting acknowledgement by the state, and
-- office staff must be able to see that difference. The aggregator is
-- asynchronous — a submission returns a transaction id which is then
-- polled — so `transaction_id` and `evvms_id` fill in at different stages.
CREATE TABLE IF NOT EXISTS evv_sync_log (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id        text REFERENCES visits(id) ON DELETE CASCADE,
  operation       text NOT NULL CHECK (operation IN ('visit_create', 'visit_update', 'visit_delete', 'caregiver_upsert')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'failed')),
  transaction_id  text,
  evvms_id        text,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  payload         jsonb,
  next_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- CARE PLAN MODULE: one row per payer/MCO service authorization (the kind
-- of record that arrives on a Molina/HHSC "Authorization Notification" —
-- service code, unit count, date range, and the payer's own task list).
-- This is now the source of truth for what a caregiver is authorized to
-- do in a client's home; the per-visit task checklist (visits.tasks)
-- should be seeded from purchased_tasks here rather than typed ad hoc.
CREATE TABLE IF NOT EXISTS service_authorizations (
  id                    text PRIMARY KEY,
  organization_id       text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id             text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  payer                 text NOT NULL,
  case_id               text,
  reference_number      text,
  service_code          text NOT NULL,
  service_description   text NOT NULL,
  modifier_codes        text,
  diagnosis_code        text,
  diagnosis_description text,
  total_hours_per_week  numeric,
  total_units_per_week  numeric,
  unit_minutes          integer NOT NULL DEFAULT 15,
  frequency             text NOT NULL DEFAULT 'Weekly',
  start_date            text NOT NULL,
  end_date              text NOT NULL,
  status                text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  purchased_tasks       jsonb NOT NULL DEFAULT '[]',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- FINANCE / BILLING MODULE: internal claim-line tracking, generated from
-- completed + EVV-verified visits against the authorization that covers
-- them. This is the pre-clearinghouse ledger — the "did we actually bill
-- what we were authorized and paid for" view for office/finance staff.
-- Submission to a real clearinghouse (Stedi et al., Phase 4 of the
-- architecture spec) reads from this table; it doesn't replace it.
CREATE TABLE IF NOT EXISTS billing_lines (
  id                       text PRIMARY KEY,
  organization_id          text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id                text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  visit_id                 text REFERENCES visits(id) ON DELETE SET NULL,
  service_authorization_id text REFERENCES service_authorizations(id) ON DELETE SET NULL,
  service_code             text NOT NULL,
  units                    numeric NOT NULL DEFAULT 0,
  service_date             text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'submitted', 'paid', 'denied')),
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caregivers_org ON caregivers(organization_id);
CREATE INDEX IF NOT EXISTS idx_referrals_org ON referrals(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_caregiver ON clients(assigned_caregiver_id);
CREATE INDEX IF NOT EXISTS idx_visits_org ON visits(organization_id);
CREATE INDEX IF NOT EXISTS idx_visits_caregiver ON visits(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_visits_client ON visits(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_org ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_caregiver ON messages(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
-- CAREGIVER HR / CREDENTIALING
--
-- Two tables with deliberately different shapes. Documents are one-time
-- artifacts with a signing or upload lifecycle (a signed confidentiality
-- agreement stays signed). Checks recur — Texas requires the DPS criminal
-- history, Employee Misconduct Registry and Nurse Aide Registry checks
-- before hire AND annually thereafter (Health & Safety Code §253.008;
-- 26 TAC §558.246, §558.247, §558.289), so each row carries its own
-- next_due_on. None of the three has an API — they are manual HHSC
-- lookups — so the app's job is recording that they happened and
-- surfacing when they are due again.
CREATE TABLE IF NOT EXISTS caregiver_documents (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  doc_type        text NOT NULL CHECK (doc_type IN ('application', 'confidentiality', 'handbook', 'hep_b', 'i9', 'tb_screening')),
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'sent', 'signed', 'declined', 'uploaded')),
  completed_on    text,
  expires_on      text,
  file_reference  text,
  notes           text,
  -- How this document reached 'signed': an office staffer recording it by
  -- hand (the original design) vs. a real DocuSign envelope the caregiver
  -- signed themselves. envelope_id is DocuSign's own envelope GUID, kept
  -- so the audit trail / certificate of completion can be pulled later.
  signed_via      text NOT NULL DEFAULT 'office_recorded' CHECK (signed_via IN ('office_recorded', 'docusign')),
  envelope_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, doc_type)
);

CREATE TABLE IF NOT EXISTS caregiver_checks (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  check_type      text NOT NULL CHECK (check_type IN ('dps_criminal', 'emr', 'nar')),
  completed_on    text NOT NULL,
  next_due_on     text,
  performed_by    text,
  result          text NOT NULL DEFAULT 'clear' CHECK (result IN ('clear', 'flagged')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- EMPLOYMENT APPLICATION: the structured replacement for the paper PAS
-- application. One row per caregiver, submitted from the caregiver's own
-- onboarding checklist. Employers, references and availability are jsonb
-- because they are repeating groups the office reads rather than queries.
-- This is employee HR data and is only ever exposed on admin screens.
CREATE TABLE IF NOT EXISTS caregiver_applications (
  id                    text PRIMARY KEY,
  organization_id       text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id          text NOT NULL UNIQUE REFERENCES caregivers(id) ON DELETE CASCADE,
  full_name             text NOT NULL,
  date_of_birth         text,
  phone                 text,
  email                 text,
  address               text,
  city                  text,
  state                 text,
  zip                   text,
  position_applied      text,
  employment_type       text,
  available_start       text,
  work_authorized       boolean,
  worked_here_before    boolean,
  reliable_transport    boolean,
  drivers_license       boolean,
  criminal_disclosure   boolean,
  criminal_explanation  text,
  has_pas_experience    boolean,
  experience_years      text,
  employers             jsonb NOT NULL DEFAULT '[]',
  references_list       jsonb NOT NULL DEFAULT '[]',
  days_available        jsonb NOT NULL DEFAULT '[]',
  certified_true        boolean NOT NULL DEFAULT false,
  submitted_at          timestamptz NOT NULL DEFAULT now()
);

-- TRAINING
--
-- Courses carry an hours value and an initial/annual type from day one.
-- Nothing in the app enforces annual hours yet, but training history
-- cannot be reconstructed retroactively — capturing it now is what makes
-- an annual training report possible later. See the spec's §6.
CREATE TABLE IF NOT EXISTS training_courses (
  id               text PRIMARY KEY,
  organization_id  text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  video_url        text,
  duration_minutes integer,
  hours            numeric NOT NULL DEFAULT 0,
  course_type      text NOT NULL DEFAULT 'initial' CHECK (course_type IN ('initial', 'annual')),
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_completions (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  course_id       text NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  hours_credited  numeric NOT NULL DEFAULT 0,
  UNIQUE (caregiver_id, course_id)
);

-- ATTENDANT ORIENTATION: required per caregiver-client pairing under
-- 26 TAC §97 — not once per hire. Every field the paper form asks for
-- already exists elsewhere in Hearth (client record, the authorization's
-- purchased_tasks, the visit schedule), so an orientation row stores only
-- what is specific to this orientation event; the document itself is
-- rendered from live data at view time. See the project doc
-- "caregiver-onboarding-training-spec.md" §7.
CREATE TABLE IF NOT EXISTS caregiver_orientations (
  id                text PRIMARY KEY,
  organization_id   text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id      text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  client_id         text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  orientation_type  text NOT NULL DEFAULT 'initial' CHECK (orientation_type IN ('initial', 'annual', 'other')),
  method            text CHECK (method IN ('in_person', 'telephone', 'video', 'other')),
  oriented_on       text,
  agency_rep_name   text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  notes             text,
  -- Same signed_via/envelope_id pattern as caregiver_documents. This
  -- document contains client PHI (name, HHSC individual number, care
  -- tasks), so the 'docusign' path is only ever reachable when the
  -- organization's DocuSign connection has baa_on_file = true — enforced
  -- in actions/docusign.js, not just in the UI.
  signed_via        text NOT NULL DEFAULT 'office_recorded' CHECK (signed_via IN ('office_recorded', 'docusign')),
  envelope_id       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- E-SIGNATURE (DocuSign)
--
-- Two-tier design, decided in caregiver-onboarding-training-spec.md: the
-- caregiver onboarding packet (confidentiality, handbook, Hep B — no PHI)
-- can go out under any DocuSign plan, but the Attendant Orientation
-- document carries client PHI and DocuSign only signs a HIPAA BAA through
-- a custom enterprise agreement (not the free/developer tier, not even
-- self-serve Business Pro). baa_on_file is the gate: it defaults false,
-- and every code path that would send PHI through DocuSign checks it
-- server-side before creating that envelope.
--
-- Credentials here follow the same pattern as organization_evv_credentials:
-- one row per tenant, private key encrypted at rest (AES-256-GCM, see
-- lib/secrets.js), never returned to the browser or logged. DocuSign's
-- JWT Grant auth needs three identifiers (integration_key, api_username,
-- account_id) plus the RSA private key half of a keypair whose public
-- half was registered on the DocuSign app.
CREATE TABLE IF NOT EXISTS organization_docusign_credentials (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  api_username    text NOT NULL,
  account_id      text NOT NULL,
  private_key_enc text NOT NULL,
  environment     text NOT NULL DEFAULT 'demo' CHECK (environment IN ('demo', 'production')),
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'testing', 'connected', 'disabled')),
  baa_on_file     boolean NOT NULL DEFAULT false,
  last_success_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_auth_org ON service_authorizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_auth_client ON service_authorizations(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_lines_org ON billing_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_lines_client ON billing_lines(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_lines_visit ON billing_lines(visit_id);
CREATE INDEX IF NOT EXISTS idx_orientations_org ON caregiver_orientations(organization_id);
CREATE INDEX IF NOT EXISTS idx_orientations_client ON caregiver_orientations(client_id);
CREATE INDEX IF NOT EXISTS idx_orientations_caregiver ON caregiver_orientations(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_evv_sync_org ON evv_sync_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_evv_sync_visit ON evv_sync_log(visit_id);
CREATE INDEX IF NOT EXISTS idx_evv_sync_status ON evv_sync_log(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cg_applications_org ON caregiver_applications(organization_id);
CREATE INDEX IF NOT EXISTS idx_cg_documents_org ON caregiver_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_cg_documents_caregiver ON caregiver_documents(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_cg_checks_org ON caregiver_checks(organization_id);
CREATE INDEX IF NOT EXISTS idx_cg_checks_caregiver ON caregiver_checks(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_courses_org ON training_courses(organization_id);
CREATE INDEX IF NOT EXISTS idx_completions_org ON training_completions(organization_id);
CREATE INDEX IF NOT EXISTS idx_completions_caregiver ON training_completions(caregiver_id);

-- NOTE ON MIGRATING AN EXISTING DEV DATABASE:
-- CREATE TABLE IF NOT EXISTS is a no-op against a database that already has
-- these tables from the pre-multi-tenant schema — it will NOT retroactively
-- add the new organization_id columns. For local/dev databases (no real
-- data to preserve), the simplest path is to drop and recreate:
--   dropdb hearth && createdb hearth && npm run db:setup && npm run db:seed
-- A production migration would instead ALTER TABLE ... ADD COLUMN
-- organization_id (nullable), backfill every row to a single default
-- organization, then ALTER COLUMN ... SET NOT NULL — see §2 of the
-- multitenant-hhaexchange-architecture-spec.md project doc.
