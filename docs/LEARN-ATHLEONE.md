# Learn Athleone: a guide for the person running it

This guide explains what Athleone does, who uses which part, how the code fits
together, and how to demo it and change it safely. Read it once top to bottom.
After that, use the headings to find things.

---

## 1. What Athleone is

Athleone is software for Texas home-care agencies (IHSS / personal attendant
services). A single Athleone server runs many agencies at once. Each agency's
data is walled off from the others. This is called *multi-tenant*: each agency
is a *tenant*, stored as a row in `organizations`.

For one agency, Athleone covers the whole working loop:

1. **Referral in.** A health plan or hospital sends a referral (usually by
   fax). A coordinator turns it into a client with an intake form.
2. **Plan and schedule.** The payer's service authorization becomes a care
   plan (approved tasks and units). The office schedules visits and assigns
   caregivers.
3. **Visit happens.** The caregiver clocks in and out on their phone. Athleone
   records time and GPS: this is **EVV**, Electronic Visit Verification, which
   Texas Medicaid requires.
4. **Fix and send.** Visits with problems get *visit maintenance* using Texas
   (HHSC) reason codes. Clean visits are exported to the state's EVV
   aggregator (HHAeXchange).
5. **Bill.** Completed, verified visits become draft billing lines.
6. **People.** Caregivers apply, sign onboarding documents (DocuSign), take
   training, get background checks, and message the office.

---

## 2. Who uses what

| Role | Signs in and lands on | What they do |
|---|---|---|
| **Platform admin** (Athleone staff: you) | `/platform` | Onboard new agencies, see every agency's go-live status, email/SMS health. Cannot see any agency's clients. |
| **Admin** (agency owner/manager) | `/admin` | Everything inside their own agency |
| **Location admin** (branch manager) | `/admin` | Same screens, narrowed to one location |
| **Coordinator** (intake) | `/referrals` | Referrals, intake, client list |
| **Caregiver** | `/caregiver` (phone) | Schedule, clock in/out, care-plan checklist, messages, training, onboarding |

Demo logins (after `npm run db:seed`):

| Who | Email | Password |
|---|---|---|
| Admin | `admin@hearth.demo` | `admin123` |
| Coordinator | `coordinator@hearth.demo` | `coordinator123` |
| Caregivers | `maria@`, `denise@`, `thomas@`, `priya@hearth.demo` | `caregiver123` |
| Admin of a second agency (isolation check) | `admin@secondagency.demo` | `admin123` |

Platform admins are created only from the command line
(`scripts/create-platform-admin.mjs`), on purpose.

---

## 3. A 20-minute client demo script

Use two browser windows side by side. Log the admin in on a laptop and Denise
on a phone, or in a narrow window.

1. **The agency's day** (`/admin`, as admin). KPIs, the *Needs attention*
   panel, and the charts.
2. **A fax becomes a client** (as coordinator). Open **Fax Inbox** and click
   **Try a sample fax → Molina authorization**. Athleone reads it and fills
   in every field. Show the original on the left, the confidence marks, and
   the checks: the hospital sample flags its missing authorization and hours.
   Click **Approve** to create the referral, then **Start Intake**. The
   Medicaid ID, address and dates are already filled in. **Submit**, and the
   client appears under Clients. Scanned faxes and phone photos need a
   document-reading service, which isn't connected yet (see below).
3. **Care plan** (`/admin/care-plans`). The authorization with its service
   code, units and approved tasks. This is what the caregiver's checklist and
   the billing lines come from.
4. **Schedule** (`/admin/schedule`). This week's visits, with week-by-week
   navigation.
5. **Caregiver on the phone** (Denise). Her schedule shows today's visit. Open
   it, tick care-plan tasks, **Clock Out** (the phone asks for location).
   Point out the "Where are you?" picker. It's Texas' location categories.
6. **EVV compliance** (`/admin/evv`, then `/admin/compliance`). Her visit is
   now completed and verified. Show the Texas usage score against the 80%
   minimum, the enforcement ladder, and the 95-day visit maintenance queue.
7. **Visit maintenance.** Open a visit with an exception (e.g. *210 — no
   clock-in*), then show reason codes, the audited fix and the VMUR path.
8. **EVV Export** (`/admin/evv/export`). The state of every finished visit:
   ready, held, needs maintenance, accepted. Explain that live transmission
   needs the agency's HHAeXchange credentials (see §7).
9. **Messages** (`/admin/messages`). Denise's "car wouldn't start" message is
   waiting (unread badge). Reply, and it appears on her phone with a badge.
   With Twilio connected she'd also get a text. She can text back to the
   agency number and it lands in the same thread.
10. **Onboarding and e-signature.** On a caregiver's profile, show the
    checklist: application, DocuSign packet, training, checks. Then open
    E-Signature and show DocuSign connected.
11. **Security.** Two-step sign-in (Account, then choose email or text), and
    forgot-password. Mention the Audit Log and per-location access.
12. **Two agencies, one server.** Sign in as `admin@secondagency.demo` and show
    that none of the first agency's data is visible.

Close with the list in §7 of what you need from the client to go live.

---

## 4. How the code fits together

```
 Browser / phone app
        │  every request
        ▼
 proxy.js ─────────── signed-in? allowed for this role?  (lib/permissions.js)
        │
        ▼
 app/…/page.js        Server Components: read data, render HTML
        │  forms & buttons call ↓
 actions/*.js         Server Actions: every change (requirePermission first)
        │
        ▼
 lib/queries.js       ALL SQL, every function takes organizationId first
        │
        ▼
 Postgres  (db/schema.sql)

 Side systems:
 lib/comms/           email + SMS (SendGrid/Postmark/Resend/SMTP, Twilio) → outbox table
 lib/docusign.js      DocuSign e-signature (per agency credentials)
 lib/hhaexchange.js   Texas EVV aggregator (per agency credentials)
 app/api/webhooks/…   Twilio + DocuSign call back in here (signature-verified)
```

Key ideas:

- **Server Components + Server Actions.** Pages query the database directly
  on the server. Every button or form that changes data calls a function in
  `actions/`. There is no separate REST API.
- **One place for SQL.** `lib/queries.js`. If you're looking for "how does X
  get saved?", search there.
- **One place for permissions.** `lib/permissions.js` lists every page and
  action with the roles allowed. `proxy.js` enforces pages;
  `requirePermission()` enforces actions. Check coverage with
  `node scripts/verify-permissions-coverage.mjs`.
- **Sessions.** A signed cookie (`hearth_session`), re-checked against the
  database on every request (`lib/auth.js getSession`). So deactivating
  someone, or resetting their password, takes effect on their next click.
- **No ORM.** Plain SQL with the `pg` driver. The README explains why.

### Follow one action through the code: a caregiver clocks out

1. `app/caregiver/visit/[id]/page.js` renders the visit and a
   `ClockOutButton` (`components/caregiver/ClockButton.js`).
2. The button gets GPS from the phone and calls `clockOutAction` in
   `actions/caregiver.js`.
3. `clockOutAction` runs `requirePermission('caregiver.visit.clock')`, checks
   that the visit belongs to *this* caregiver, and calls `db.clockOut()`.
4. `clockOut()` in `lib/queries.js` saves the time and GPS, applies the
   agency's flexible-hours rule, and raises a Texas reason code if something
   is off.
5. `revalidatePath()` refreshes the screens, so the admin's EVV page shows it
   right away.

---

## 5. Folder map

| Folder / file | What's in it |
|---|---|
| `app/` | Every screen. `admin/`, `caregiver/`, `(dashboard)/` (intake), `platform/`, `login/`, `api/` (health + webhooks) |
| `actions/` | Server Actions, one file per area |
| `lib/queries.js` | All database reads and writes |
| `lib/permissions.js` | Roles, and which role can reach which page/action |
| `lib/comms/` | Email/SMS: `config.js` (env settings), `providers.js`, `templates.js` (all wording), `index.js` (sendEmail/sendSms) |
| `lib/sign-in.js` | Forgot password, two-step codes, welcome invites |
| `lib/messaging.js`, `lib/inbound-sms.js` | Who gets notified about messages; texts coming in |
| `lib/state-compliance.js`, `lib/evv-*.js` | Texas EVV rules, reason codes, aggregator payloads |
| `db/schema.sql` | The full database shape (fresh installs) |
| `db/migrations/*.sql` | Changes for existing databases |
| `scripts/` | `migrate.mjs`, `seed.mjs`, `create-platform-admin.mjs`, QA suites in `qa-locations/` |
| `components/` | Shared UI pieces |
| `deploy/`, `Dockerfile`, `docker-compose.yml`, `.do/` | Running on DigitalOcean |
| `mobile/` | Android app wrapper (Capacitor) |
| `docs/` | This guide, troubleshooting log, security charter |

---

## 6. Everyday commands

```bash
npm run dev                 # local app at http://localhost:3000
npm run db:migrate          # bring your database up to date (safe to run any time)
npm run db:migrate:status   # what's applied / pending
npm run db:seed             # reset demo data (wipes users + demo agencies)
bash scripts/qa-locations/run-qa.sh .   # all automated tests (~900 checks, ~10 s)
node scripts/verify-permissions-coverage.mjs
npm run build && npm start  # production build locally
```

Locally, nothing needs email or Twilio keys. Messages that would go out are
printed in the terminal and listed on **Communications → Outbox**. That
includes reset links and sign-in codes, which lets you test those flows.

---

## 7. Integrations: status, and what you need from the client

| Integration | Status | Needed to go live |
|---|---|---|
| **Email** (resets, codes, welcome, notices) | Built; plug in keys | A SendGrid/Postmark/Resend account (or the agency's Microsoft 365 SMTP) and a verified sending domain |
| **SMS** (notices, codes, texts in) | Built; plug in keys | Twilio account + number, **A2P 10DLC registration** (takes days) |
| **DocuSign** | Built and tested end to end in the demo environment; Connect webhook added | The agency's DocuSign account (or yours), go-live review of the integration key, a signed DocuSign BAA before documents with client data are sent |
| **HHAeXchange (Texas EVV)** | Payload mapping, sender, sandbox mock, export screen built | The agency's HHAeXchange/TMHP provider enrollment and API credentials, then HHAeXchange's certification testing |
| **Payroll (Gusto Embedded)** | Planned, not built | Gusto partnership |
| **Fax intake / OCR** | Built: Fax Inbox with the demo reader (typed PDFs), review & approve (docs/FAX-INTAKE.md) | A document-reading service for scans (Azure AI Document Intelligence planned, with a BAA); a HIPAA fax service with a webhook and BAA |

A good ask for the client after the demo: *"To test live, I need: your
HHAeXchange provider credentials (sandbox first), a DocuSign account user, and
your OK for Athleone to text your caregivers from our number."*

---

## 8. Making a change safely

1. **Database change?** Put the final shape in `db/schema.sql` **and** add
   `db/migrations/<date>-<n>-<name>.sql` with the `ALTER`. Run
   `npm run db:migrate`. On the server, migrations run automatically when the
   app restarts.
2. **New page or action?** Add its entry to `lib/permissions.js` (and
   `ROUTE_PERMISSIONS` for a page), then run
   `node scripts/verify-permissions-coverage.mjs`.
3. **New query?** `organizationId` goes first and every `WHERE` filters on it.
   This is the rule that keeps agencies apart.
4. **Sending something?** Use `sendEmail`/`sendSms` from `lib/comms` with a
   template in `lib/comms/templates.js`. Never put client health information
   in a template. Mark anything containing a link or code `sensitive: true`.
5. **Test it.** Add checks to a suite in `scripts/qa-locations/` and run
   `run-qa.sh`.
6. **Troubleshooting?** Check `docs/TROUBLESHOOTING.md` first. When you solve
   something new, add it there.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **EVV** | Electronic Visit Verification: federally required proof of when and where a Medicaid home visit happened (the 6 data elements from the 21st Century Cures Act) |
| **HHSC** | Texas Health and Human Services Commission: sets the EVV rules |
| **HHAeXchange** | Texas' state EVV aggregator: agencies' EVV systems send visits here |
| **TMHP** | Texas Medicaid & Healthcare Partnership: runs provider enrollment and claims |
| **Reason code** | HHSC code explaining a visit change, e.g. 110 (schedule variance), 210 (no clock in/out), 600 (other) |
| **Visit maintenance** | Correcting an EVV visit record, allowed within 95 days |
| **VMUR** | Visit Maintenance Unlock Request: reopening a visit after the 95-day window |
| **EVV Usage Score** | Share of an agency's visits verified electronically each quarter. Minimum 80%. |
| **Service authorization** | The payer's approval: service code, units, dates, tasks |
| **PHI** | Protected health information: anything identifying a client together with their care |
| **BAA** | Business Associate Agreement: a HIPAA contract required with any vendor that touches PHI |
| **Tenant / organization** | One agency on the Athleone platform |
| **Outbox** | The record of every email/text Athleone sent (`notifications` table) |

---

## 10. Honest list: what's between this and real client data

- Signed BAAs: DigitalOcean, the email provider, Twilio, DocuSign.
- HHAeXchange certification (planned after the demo).
- Remove the demo logins on any server with real data; turn on required
  two-step sign-in for office staff once email is connected.
- Backups tested with a real restore; an uptime monitor on `/api/health`.
- An outside security review / penetration test before the first agency
  goes live.
- Not built yet: Gusto payroll, iPhone app store build (iPhone
  users can use Add to Home Screen), push notifications.


---

## What changed on 2026-09-26 (fax reading)

- **Fax Inbox review screen:**
  - **What is this document?** An *Authorization notice* needs the
    authorization #, overall status, start date, and hours or units. A
    *Referral* can be approved without them and waits as "Awaiting
    authorization".
  - **Plan member ID vs Medicaid ID.** A plain "Member ID" goes to Plan
    member ID. One click (audit-logged) confirms it as the Medicaid ID.
  - **Service lines.** Every line on the fax is kept. You pick the primary
    line, and the care plan is built from it.
  - **Missing or doubtful IDs need a reason** before approving (see
    `docs/FAX-INTAKE.md`).
  - **Warnings for a wrong-agency fax:** the servicing provider or NPI isn't
    yours.
- **Care plan at intake.** Completing intake on a fax-sourced referral
  creates the client's care plan (service authorization) from the fax.
- **42 reader fields.** The field names a reading service's custom model
  should use are in `docs/docai-schema-fields.csv`.
- **Migrations this week:** `2026-09-26-01` (Fax Inbox), `-02` (hardening),
  `-03` (referrals without an authorization #). Run `npm run db:migrate`
  after pulling.

---

## What changed on 2026-09-28 (paid Google services removed)

Ahead of the move to Azure, everything that called a paid Google service is
gone: **Google Document AI** (`lib/docai/google.js`), the **Google sign-in**
helper (`lib/google-auth.js`), the **Cloud Storage** file driver, the schema
script (`scripts/docai-set-schema.mjs`) and the **Google Cloud deploy kit**
(`deploy/gcp/`, `deploy/DEPLOY-GOOGLE-CLOUD.md`).

- Fax reading uses the free demo reader (typed PDFs). Scans are entered by
  hand until Azure AI Document Intelligence is connected; the plug-in point
  is `ENGINES` in `lib/docai/index.js`.
- Fax files are kept on local disk / a mounted volume (`STORAGE_DRIVER=local`).
- Old settings are caught at startup: `STORAGE_DRIVER=gcs` stops a production
  server, `DOCAI_PROVIDER=google` and leftover `GOOGLE_*`, `DOCAI_PROCESSOR_ID`
  or `GCS_BUCKET` lines give a warning.
- No database change. Documents already read by Google still show
  "read by Google Document AI".
- Still from Google, free and not a paid service: the Nunito/Karla web fonts
  and "open in Google Maps" links.

---

## What changed on 2026-09-28 (Payroll Hours)

**Admin → Payroll Hours** (`/admin/payroll`) is the attendant visit log a
payroll company works from, modelled on the agency's current "Service
Attendant Visit Log":

- **Pay period:** twice a month (1st–15th, 16th–end) by default, weekly, or a
  custom range (up to 62 days). Arrows step between periods.
- **One section per attendant:** date, visit ID, client, bill code and
  modifier (from the care plan), scheduled time, clock times, scheduled /
  verified / bill hours, and a total with the variance.
- **Verified hours** are clock-in to clock-out, and only for visits that are
  completed, EVV-verified and have no open exception. Anything else (open
  exception, no clock-in, never clocked out, clock times that don't make
  sense) is listed with a **Fix →** link to visit maintenance, so no one is
  underpaid by accident. Missed visits are listed but need no fix.
- **Bill hours** are what the visit bills for: scheduled time, or less after
  a 110 B adjustment (marked *).
- **40-hour check:** each Monday–Sunday workweek is totalled across the whole
  week, even when a twice-a-month period splits it, and flagged in red past
  40 hours.
- **Download CSV:** one row per verified visit plus a total row per
  attendant. It leaves out Medicaid IDs, diagnoses and addresses (minimum
  necessary), guards against spreadsheet formulas, and every download is in
  the Audit Log (`payroll_hours_exported`).
- **Who sees it:** ADMIN (all attendants) and LOCATION_ADMIN (attendants in
  their location), permission `admin.payroll.view`.
- Pay rates, overtime pay and deductions stay in the payroll system for now.
  No database change. Code: `lib/payroll-hours.js`, `getPayrollVisits` in
  `lib/queries.js`, `app/admin/payroll/`. QA: `qa-2026-09-28-payroll-hours.mjs`.

---

## What changed on 2026-09-28 (Payroll: pay, approval, lock)

⚠️ **Database migration:** `db/migrations/2026-09-28-01-payroll-pay.sql` adds
`caregiver_pay_rates` and `payroll_periods`. Run `npm run db:migrate` after
pulling. To undo, drop those two tables; no other table changes.

- **Pay rates** (`/admin/payroll/rates`, ADMIN only): each attendant's
  default hourly rate, plus optional rates for particular clients. Rates
  below the minimum wage ($7.25) are refused; every change is audit-logged
  with the old and new rate. Athleone never guesses a rate: a visit with no
  rate shows "No rate" and blocks approval.
- **Gross pay** on `/admin/payroll` (ADMIN only; a LOCATION_ADMIN still sees
  hours only): verified hours × rate, plus the **overtime premium**. Hours
  past 40 in a Monday–Sunday workweek earn an extra half of that week's
  regular rate, which is the week's straight-time pay ÷ its hours (the
  weighted average when an attendant has more than one rate). The premium is
  paid in the pay period in which the week ends.
- **Approve and lock:** once the period has ended and nothing needs fixing,
  an admin ticks "I checked…" and approves. The server rebuilds every number
  itself, refuses if anything changed while the page was open, and stores a
  frozen copy (the snapshot). Later edits to a visit or a rate are listed as
  "changed since approval" and are not applied. **Reopen** (with a reason)
  unlocks it; the old approval stays in the history.
- **Payroll files:** *Visit detail* (with rate and pay for admins) and *Pay
  summary per attendant* (hours worked, straight-time pay, overtime hours,
  premium, gross). They come from the approved copy once approved, and every
  download is audit-logged.
- Tax withholding, deductions, direct deposit and filings stay with the
  payroll provider (Gusto later). Code: `lib/payroll-pay.js`,
  `lib/payroll-report.js`, `actions/payroll.js`,
  `components/admin/PayrollForms.js`. QA: `qa-2026-09-28-payroll-pay.mjs`
  (61 checks).

