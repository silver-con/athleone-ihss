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

-- provider_enrollment_attested and baa_signed are self-attestation flags
-- an agency's own admin checks on the onboarding go-live checklist
-- (/admin/onboarding) — same pattern as organization_docusign_credentials.
-- baa_on_file elsewhere in this schema: Hearth's software has no way to
-- verify either claim, so it records the attestation, not proof. Note
-- baa_signed is the master Hearth<->agency Business Associate Agreement
-- (architecture spec §6) — a different document from DocuSign's own BAA
-- (organization_docusign_credentials.baa_on_file), which separately gates
-- whether PHI-bearing documents can go through DocuSign specifically.
--
-- SCHEMA DRIFT WARNING: same class of issue as the DocuSign signed_via/
-- envelope_id columns before it — CREATE TABLE IF NOT EXISTS is a no-op
-- against a pre-existing organizations table, so none of these columns
-- will retroactively appear on a real dev database via `npm run db:setup`.
-- If you have a pre-existing dev database and want to keep its data, run
-- scripts/migrate-2026-09-21-multi-state.mjs (idempotent, safe to re-run)
-- rather than hand-applying ALTERs here — it also handles the
-- texas_medicaid_provider_number / hcssa_license_number renames below,
-- which a plain ADD COLUMN IF NOT EXISTS can't express.
-- Otherwise, for a disposable local/dev database: dropdb hearth && createdb
-- hearth && npm run db:setup && npm run db:seed.
--
-- Same story again for flexible_hours_enabled / flexible_hours_grace_minutes
-- below (added 2026-09-23) — run scripts/migrate-2026-09-23-flexible-hours.mjs
-- against a pre-existing dev database rather than relying on this file.
--
-- state / medicaid_provider_number / state_license_number generalize what
-- used to be Texas-only columns (state was implicitly always Texas;
-- texas_medicaid_provider_number and hcssa_license_number were named
-- after Texas's own provider-identifier terms) now that an agency can be
-- registered in any state — see multi-state-expansion-architecture-spec.md
-- (the project doc). 'TX' stays the default since every tenant on this
-- system today is a Texas agency.
CREATE TABLE IF NOT EXISTS organizations (
  id                            text PRIMARY KEY,
  name                          text NOT NULL,
  state                         text NOT NULL DEFAULT 'TX',
  medicaid_provider_number      text,
  npi                           text,
  state_license_number          text,
  provider_enrollment_attested  boolean NOT NULL DEFAULT false,
  baa_signed                    boolean NOT NULL DEFAULT false,
  baa_signed_at                 timestamptz,
  status                        text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
  -- Per-organization "configurator" settings — added 2026-09-23, first
  -- entry of what's meant to grow into a shared settings surface rather
  -- than one-off hardcoded constants (see the project doc
  -- vesta-evv-feature-reference.md's "Full Configurator candidate-settings
  -- assessment" section for the many other settings expected to join it —
  -- reason-code requirements, the visit-maintenance window, GPS distance
  -- thresholds, etc.). flexible_hours_enabled: when true, a caregiver's
  -- actual clock-in/out times may differ from the scheduled visit window
  -- (the agency's real requirement, confirmed by the user, is completing
  -- the full scheduled/authorized hours within the same day, not matching
  -- the clock times exactly). flexible_hours_grace_minutes: how far PAST
  -- the visit's scheduled END time a clock-out can drift and still be
  -- clean — later than that raises Texas reason code 110A ("Service
  -- Delivery Exception — schedule variance", lib/state-compliance.js) for
  -- office review via the existing resolveVisitException flow. See
  -- clockOut() in lib/queries.js for where this is applied. Defaults to
  -- DISABLED (false) — opt-in per org, same defensive default as the
  -- other self-attested/off-by-default flags on this table
  -- (provider_enrollment_attested, baa_signed). This matters more than
  -- usual here: WEEK_DAYS/TODAY_ISO in lib/data.js are a fixed demo
  -- reference week (2026-09-14 through 2026-09-20), not the real rolling
  -- calendar date, so every visit scheduled through createVisit() today
  -- already has a "scheduled end" in the past by the time it's clocked
  -- out in real time — enabling this by default would flag nearly every
  -- real clock-out as an exception until that separate, pre-existing
  -- limitation is fixed. Turn this on per-org only once that's true.
  flexible_hours_enabled        boolean NOT NULL DEFAULT false,
  flexible_hours_grace_minutes  integer NOT NULL DEFAULT 20 CHECK (flexible_hours_grace_minutes >= 0 AND flexible_hours_grace_minutes <= 480),
  -- Agency's own deadline (days after the date of service) for finishing
  -- visit maintenance, added 2026-09-23. NULL = use the state's window
  -- (Texas: 95 days, HHSC EVV Policy Handbook §9050). An agency may set a
  -- SHORTER internal deadline, never a longer one — lib/queries.js
  -- updateOrganizationEvvSettings enforces that against the state profile.
  visit_maintenance_window_days integer CHECK (visit_maintenance_window_days IS NULL OR (visit_maintenance_window_days >= 1 AND visit_maintenance_window_days <= 365)),
  -- How close (in feet) a GPS clock event must be to the client's home to
  -- count as "at home" — Vesta uses 250 ft. Added 2026-09-24.
  home_radius_feet              integer NOT NULL DEFAULT 250 CHECK (home_radius_feet >= 50 AND home_radius_feet <= 2000),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- SCHEMA DRIFT WARNING (locations + everything below that references
-- it): this is the third time today this exact class of issue has come
-- up (see organizations' and platform_admins' own drift warnings above) —
-- CREATE TABLE IF NOT EXISTS and a bare CREATE TABLE for a brand-new
-- table are both no-ops against a database that's already been set up
-- once, so `locations` plus every new column on the four PRE-EXISTING
-- tables below (caregivers, clients, users, service_authorizations) will
-- NOT appear on a real dev database via `npm run db:setup`. Against a
-- pre-existing dev database you want to keep, run all of these:
--   CREATE TABLE IF NOT EXISTS locations (
--     id              text PRIMARY KEY,
--     organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
--     name            text NOT NULL,
--     commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
--     status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
--     created_at      timestamptz NOT NULL DEFAULT now()
--   );
--   ALTER TABLE caregivers ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
--   ALTER TABLE clients ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id text REFERENCES locations(id) ON DELETE SET NULL;
--   ALTER TABLE service_authorizations ADD COLUMN IF NOT EXISTS rate_per_unit numeric;
--   CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
--   CREATE INDEX IF NOT EXISTS idx_caregivers_location ON caregivers(location_id);
--   CREATE INDEX IF NOT EXISTS idx_clients_location ON clients(location_id);
--   CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_id);
-- Otherwise, for a disposable local/dev database: dropdb hearth && createdb
-- hearth && npm run db:setup && npm run db:seed.

-- LOCATIONS — an agency (organizations row) may operate more than one
-- physical branch/franchise under its single Texas license. This is
-- deliberately a THIRD tier under organization_id, not a replacement for
-- it: the Medicaid provider number, NPI, HCSSA license, EVV/DocuSign
-- credentials, and BAA all stay on `organizations` (the license itself is
-- agency-wide, not per-branch — see the multitenant-hhaexchange-
-- architecture-spec.md project doc, "Locations & franchise commissions").
-- Only day-to-day operational data — which caregivers, which clients, and
-- the revenue that flows from their visits — is what a location scopes.
-- commission_rate is what the agency (the license holder) takes from a
-- location's revenue when that location operates as a partner/franchise
-- under the agency's license, per the org admin's own franchise terms
-- with that location — 0 for a location that isn't a revenue-share
-- arrangement at all (the agency's own branch, say).
CREATE TABLE IF NOT EXISTS locations (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now()
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
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('applicant', 'onboarding', 'active', 'on-leave', 'inactive')),
  -- NULL = not assigned to a location (agency-wide/unassigned — the only
  -- state possible before an agency creates any locations, and still a
  -- valid state after: not every caregiver has to belong to one).
  location_id     text REFERENCES locations(id) ON DELETE SET NULL
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
  -- Set at intake (see IntakeForm.js) — which branch/franchise location
  -- this client belongs to. NULL for agencies with no locations, or for a
  -- client an agency deliberately keeps agency-wide.
  location_id           text REFERENCES locations(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- EVV member identity, added 2026-09-23. The state aggregator identifies
  -- the member by their 9-digit Texas Medicaid ID; before this column
  -- existed, lib/evv-mapping.js fell back to Hearth's internal client id,
  -- which the aggregator would reject. hhsc_individual_number above is a
  -- different identifier (HHSC/DADS individual #, used on the 26 TAC §97
  -- orientation form) and is NOT sent as the Medicaid ID.
  -- date_of_birth is ISO 'YYYY-MM-DD' text (not a DATE column) so pg never
  -- shifts it through a JS Date/timezone conversion.
  -- address_line1/city/state/zip are the structured service address; the
  -- free-text `address` column above stays as the display string.
  medicaid_id           text CHECK (medicaid_id IS NULL OR medicaid_id ~ '^[0-9]{9}$'),
  date_of_birth         text CHECK (date_of_birth IS NULL OR date_of_birth ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  address_line1         text,
  city                  text,
  state                 text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  zip                   text CHECK (zip IS NULL OR zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  -- The client's home location, used to show how far each clock event was
  -- from home (Vesta's "Distance In/Out"). Added 2026-09-24. Hearth has no
  -- geocoding service, so it is either LEARNED from the first accurate GPS
  -- clock-in a caregiver marks as "Client's home", taken by staff from a
  -- specific visit's clock-in, or entered by staff (e.g. pasted from a
  -- map). home_location_source records which.
  home_lat              double precision CHECK (home_lat IS NULL OR (home_lat >= -90 AND home_lat <= 90)),
  home_lng              double precision CHECK (home_lng IS NULL OR (home_lng >= -180 AND home_lng <= 180)),
  home_location_source  text CHECK (home_location_source IS NULL OR home_location_source IN ('learned', 'from_visit', 'entered')),
  home_location_set_at  timestamptz,
  home_location_set_by  text
);

-- One Medicaid ID belongs to one client per agency — a duplicate almost
-- always means the same person was taken in twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_org_medicaid_id
  ON clients(organization_id, medicaid_id) WHERE medicaid_id IS NOT NULL;

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
  -- Real captured wall-clock timestamps and device geolocation for each
  -- EVV event, added 2026-09-22. evv_clock_in/evv_clock_out above remain
  -- the human-readable display label ("2:47 PM"); these are the
  -- authoritative values lib/evv-mapping.js's buildVisitPayload sends to
  -- the state aggregator (two of the Cures Act's six required elements:
  -- actual time and location) and what the admin EVV log and the
  -- caregiver app both read for compliance visibility. Nullable because a
  -- pre-existing visit, or a clock event where the caregiver's device
  -- couldn't provide a location (permission denied, unsupported browser,
  -- no signal), still has to be recorded rather than blocked — a missing
  -- location here is a compliance exception for the office to review, not
  -- a reason to stop a caregiver from clocking in or out of a real visit.
  evv_clock_in_at        timestamptz,
  evv_clock_in_lat        double precision,
  evv_clock_in_lng        double precision,
  evv_clock_in_accuracy   double precision,
  evv_clock_out_at        timestamptz,
  evv_clock_out_lat       double precision,
  evv_clock_out_lng       double precision,
  evv_clock_out_accuracy  double precision,
  -- Where the caregiver said they were at each clock event (Vesta's "Loc
  -- In/Out": member_home, family_home, neighbor_home, community, other),
  -- and how far the GPS fix was from the client's home at that moment
  -- (NULL when either location is unknown). Stored rather than computed
  -- later, so correcting a client's home location never rewrites what a
  -- past visit showed. Added 2026-09-24.
  evv_clock_in_location   text CHECK (evv_clock_in_location IS NULL OR evv_clock_in_location IN ('member_home', 'family_home', 'neighbor_home', 'community', 'other')),
  evv_clock_out_location  text CHECK (evv_clock_out_location IS NULL OR evv_clock_out_location IN ('member_home', 'family_home', 'neighbor_home', 'community', 'other')),
  evv_clock_in_distance_ft  double precision,
  evv_clock_out_distance_ft double precision,
  -- Office "hold" on sending this visit to the state aggregator (Vesta's
  -- ON HOLD status). While held, the sync queue skips the visit's rows.
  -- Added 2026-09-24.
  evv_export_hold        boolean NOT NULL DEFAULT false,
  evv_export_hold_reason text,
  evv_export_hold_by     text,
  evv_export_hold_at     timestamptz,
  evv_method      text,
  evv_verified    boolean NOT NULL DEFAULT false,
  evv_exception   text,
  evv_note        text,
  tasks           jsonb NOT NULL DEFAULT '[]'
  -- service_authorization_id is added via ALTER TABLE just below the
  -- service_authorizations table further down this file, since this table
  -- (visits) is defined before service_authorizations is and a same-
  -- statement FK reference to a not-yet-existing table would fail on a
  -- fresh database. See that ALTER for the full explanation.
);

-- Visit maintenance log, added 2026-09-23. One row per correction or
-- VMUR (Visit Maintenance Unlock Request) record, never updated or
-- deleted — the auditable "why was this visit changed, by whom, and who
-- confirmed it" trail HHSC expects (EVV Policy Handbook §9000/§10000).
--   kind 'maintenance': contact -> document (reason codes, note, any
--     missing clock time entered by hand) -> verify.
--   kind 'vmur': the visit was past the maintenance window; records that
--     an unlock request was sent to the payer, with the justification.
-- Captured clock times and GPS are never edited (HHSC §9000: actual
-- clock in/out times, hours worked and GPS can't be changed); only a
-- MISSING time can be entered, and that is recorded here as manual.
CREATE TABLE IF NOT EXISTS visit_maintenance (
  id                 text PRIMARY KEY,
  organization_id    text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id           text NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  kind               text NOT NULL DEFAULT 'maintenance' CHECK (kind IN ('maintenance', 'vmur')),
  contact            text CHECK (contact IS NULL OR contact IN ('none', 'client', 'caregiver', 'substitute')),
  reason_codes       text[] NOT NULL DEFAULT '{}',
  note               text,
  manual_clock_in_at  timestamptz,
  manual_clock_out_at timestamptz,
  payer_reference    text,
  performed_by_user_id text,
  performed_by_name  text NOT NULL,
  performed_by_role  text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visit_maintenance_visit ON visit_maintenance(organization_id, visit_id, created_at);

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
  role            text NOT NULL CHECK (role IN ('COORDINATOR', 'ADMIN', 'LOCATION_ADMIN', 'CAREGIVER')),
  caregiver_id    text UNIQUE REFERENCES caregivers(id) ON DELETE CASCADE,
  -- NULL = organization-wide access. That is correct and expected for an
  -- ADMIN (the organization admin, who must see every location) and is
  -- what every pre-existing account has.
  --
  -- REQUIRED for a LOCATION_ADMIN — that role exists precisely to be
  -- scoped to one location, and actions/team.js refuses to create one
  -- without a location_id. Set automatically for a CAREGIVER from their
  -- caregiver row at creation (lib/queries.js's createCaregiverWithLogin).
  --
  -- CONSTRAINT DRIFT WARNING — a different failure mode from the column
  -- drift warned about elsewhere in this file, and one that
  -- scripts/check-schema.mjs does NOT catch: that script compares tables
  -- and columns only, never CHECK constraints. Adding 'LOCATION_ADMIN' to
  -- the role CHECK above therefore needs this run by hand against any
  -- pre-existing database, or every attempt to create a location admin
  -- fails at runtime with a constraint violation:
  --   ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  --   ALTER TABLE users ADD CONSTRAINT users_role_check
  --     CHECK (role IN ('COORDINATOR', 'ADMIN', 'LOCATION_ADMIN', 'CAREGIVER'));
  location_id     text REFERENCES locations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Account lifecycle, added 2026-09-23 (access-control pass):
  --   active: false = deactivated. Sign-in is refused and any existing
  --     session stops working on its next request (lib/auth.js getSession
  --     re-checks this row every time). Texas expects access removed
  --     within 24 hours of termination; this makes it immediate.
  --   session_version: copied into the session token at sign-in. Bumping
  --     it (deactivate, role/location change, password reset or change)
  --     invalidates every existing session for this account at once.
  --   must_change_password: DEFAULT true so every newly created account
  --     (team member, caregiver, a new agency's first admin) must replace
  --     the starting password someone else typed for them. The migration
  --     adds it as false for pre-existing accounts, then flips the default.
  active               boolean NOT NULL DEFAULT true,
  session_version      integer NOT NULL DEFAULT 1,
  must_change_password boolean NOT NULL DEFAULT true,
  password_changed_at  timestamptz,
  last_login_at        timestamptz,
  deactivated_at       timestamptz
);

-- Failed sign-in tracking, keyed by the email typed (not by account), so
-- lockout works the same whether or not the email exists — which is what
-- keeps the lockout itself from revealing which emails have accounts.
-- Covers both users and platform_admins sign-ins. See lib/login.js.
CREATE TABLE IF NOT EXISTS login_attempts (
  email          text PRIMARY KEY,
  failed_count   integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_failed_at timestamptz
);

-- PLATFORM ADMIN — Hearth's own ops staff, not any tenant's staff.
--
-- Deliberately its own table, NOT a row in `users` with organization_id
-- set to something special: `users.organization_id` is NOT NULL precisely
-- because "every user belongs to exactly one agency" is the invariant the
-- rest of the multi-tenant model leans on (see the MULTI-TENANCY note at
-- the top of this file and lib/queries.js's requireOrgId). A platform
-- admin explicitly isn't scoped to one agency — architecture spec §3 calls
-- this "the highest-risk role in the system" because it can see across
-- every tenant — so keeping it a fully separate table means no ordinary
-- organization_id-filtered query can ever accidentally match one.
--
-- There is deliberately no signup page, invite flow, or admin-UI button
-- that creates a row here — the only way is scripts/create-platform-admin.mjs,
-- run directly against the database by someone with server/DB access. See
-- the script for why, and README.md's "Platform admin" section for usage.
-- platform_role is the sub-role WITHIN the platform-admin role itself,
-- distinct from the four session roles in lib/permissions.js (ROLES) —
-- every platform admin, 'support' or 'full', still has session.role ===
-- 'PLATFORM_ADMIN' and can reach every page under /platform. 'support' can
-- view the agency dashboard and the platform team list; 'full' can
-- additionally onboard a new agency and add/deactivate platform admins.
-- Defaults to 'full' (not 'support') specifically so this column's
-- addition never silently downgrades an existing platform admin's
-- capability — see actions/platform.js for where this is enforced.
--
-- SCHEMA DRIFT WARNING: same class of issue as organizations' extra
-- columns above — CREATE TABLE IF NOT EXISTS is a no-op against a
-- pre-existing platform_admins table, so `active`/`platform_role` will NOT
-- retroactively appear on a real dev database via `npm run db:setup`. If
-- you have a pre-existing dev database and want to keep its data, run:
--   ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
--   ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'full';
--   ALTER TABLE platform_admins ADD CONSTRAINT platform_admins_platform_role_check CHECK (platform_role IN ('support', 'full'));
-- Otherwise, for a disposable local/dev database: dropdb hearth && createdb
-- hearth && npm run db:setup && npm run db:seed.
CREATE TABLE IF NOT EXISTS platform_admins (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  platform_role text NOT NULL DEFAULT 'full' CHECK (platform_role IN ('support', 'full')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every platform-admin session records what it looked at — the spec's
-- "access is logged more heavily than normal admin access" requirement.
-- v1 of the platform dashboard (2026) is read-only (no tenant data can be
-- edited from it), so today this only ever logs 'view_dashboard'; the
-- column shape is deliberately generic so a future write-capable action
-- can log here too without a schema change.
CREATE TABLE IF NOT EXISTS platform_admin_access_log (
  id                 text PRIMARY KEY,
  platform_admin_id  text NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  action             text NOT NULL,
  detail             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_log_admin ON platform_admin_access_log(platform_admin_id);

-- TENANT-SIDE AUDIT TRAIL
--
-- One level down from platform_admin_access_log above: that table only
-- ever covers Hearth's own platform-ops staff, this one covers what a
-- tenant's own ADMIN/LOCATION_ADMIN/COORDINATOR users do inside their
-- organization. Scope deliberately started narrow (see lib/queries.js's
-- logAuditEvent callers) rather than instrumenting every mutation at
-- once: a client's care plan (service authorizations), billing line
-- changes, and this tenant's own EVV credentials — the three examples
-- named in enterprise-readiness-roadmap.md's audit-trail item, and
-- usually the first things a security review asks to see logged.
-- actor_user_id is nullable (ON DELETE SET NULL) so a row survives even
-- if the user who performed the action is later removed; actor_name/role
-- are duplicated onto the row itself for the same reason platform admin
-- logging does — history stays legible without a join. Never write a
-- secret value (client id/secret, password) into `detail`.
CREATE TABLE IF NOT EXISTS audit_log (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id   text REFERENCES users(id) ON DELETE SET NULL,
  actor_name      text NOT NULL,
  actor_role      text NOT NULL,
  location_id     text REFERENCES locations(id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(organization_id, created_at DESC);

-- EVV AGGREGATOR INTEGRATION (HHAeXchange)
--
-- Credentials are per tenant, never global: each agency authenticates to
-- the state aggregator with its own OAuth2 client tied to its own Medicaid
-- provider identity. client_id/client_secret are stored encrypted
-- (AES-256-GCM, see lib/secrets.js) and are never returned to the browser
-- or written to logs.
-- aggregator: which EVV vendor this tenant transmits to (resolved by
-- lib/evv-adapters/index.js's getEvvAdapter()). Defaults to 'hhaexchange'
-- since that's Texas's HHSC-mandated aggregator and the only adapter
-- implemented so far — a state on a different vendor sets its own value
-- here rather than Hearth guessing from the tenant's state.
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
  aggregator        text NOT NULL DEFAULT 'hhaexchange',
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
  -- Dollar rate per billed unit for THIS authorization specifically —
  -- deliberately not a global rate table (see deferred-backlog.md's care
  -- plan template caution: "rates should not be baked into templates —
  -- HHSC revises them and a stale hardcoded rate is worse than none").
  -- Office staff enter the actual contracted/payer rate here when known;
  -- left NULL when not yet known, in which case this authorization's
  -- billing lines are excluded from the dollar revenue total shown on
  -- /admin/locations rather than silently counted as $0 — see
  -- getLocationRevenueSummary in lib/queries.js.
  rate_per_unit         numeric,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Which authorization a visit bills against, picked at scheduling time
-- (2026-09-22) — see createVisit/generateBillingLineForVisit in
-- lib/queries.js. A client can legitimately have more than one approved
-- authorization live at once (e.g. PAS attendant care and a separate
-- respite authorization), and before this column existed the
-- auto-generated billing line just guessed via getActiveAuthorization,
-- which stopped being a safe guess the moment there was more than one
-- live candidate — createVisit now requires an explicit pick whenever a
-- client has more than one. Added here via ALTER rather than inline on
-- the visits table above because visits is defined earlier in this file,
-- before service_authorizations exists to reference. Nullable so a
-- pre-existing visit, or one for a client with zero authorizations on
-- file, still schedules fine — generateBillingLineForVisit falls back to
-- the old best-effort guess when this is null.
ALTER TABLE visits ADD COLUMN IF NOT EXISTS service_authorization_id text REFERENCES service_authorizations(id) ON DELETE SET NULL;

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

CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_org ON caregivers(organization_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_location ON caregivers(location_id);
CREATE INDEX IF NOT EXISTS idx_clients_location ON clients(location_id);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(location_id);
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
