# Hearth — Troubleshooting Log

Running log of real incidents hit while developing this app: exact symptom,
root cause, and fix. Check here first when you see an error — it may already
be diagnosed. Read this whole file before debugging anything from scratch.

When you resolve a new incident, append a new dated entry below in the same
format, including the exact error text (so a future grep/pattern-match finds
it).

---

## 2026-09-16 — `organizationId is required` on `/admin`

**Symptom:**
```
⨯ Error: organizationId is required — every query must be tenant-scoped.
    at requireOrgId (lib/queries.js:102:11)
    at getReferrals (lib/queries.js:109:3)
    at AdminOverviewPage (app/admin/page.js:21:17)
```
Can show as a 200 with a `digest` in dev, or a straight `500`, depending on
whether a session existed at all.

**Root cause (two distinct causes, same symptom):**

1. **Stale session cookie.** `actions/auth.js` signs `organizationId` into the
   `hearth_session` JWT at login. Any cookie issued *before* that field was
   added to the payload (or before the DB actually had the column — see
   below) will verify fine but simply won't have `organizationId` in it.
   `getSession()` doesn't validate the payload shape, so a stale-but-valid
   token sails past the `if (!session) redirect('/login')` check and only
   blows up deep in `lib/queries.js`.

2. **Pre-multi-tenant local DB.** `scripts/db-setup.mjs` just runs
   `db/schema.sql`, which uses `CREATE TABLE IF NOT EXISTS` for every table.
   Against a DB where `users` (etc.) already existed from *before* the
   multi-tenancy migration, this is a silent no-op — it does NOT add the new
   `organization_id` column. So `user.organization_id` is `undefined` even on
   a completely fresh login, because the column isn't there at all.
   `db/schema.sql` has a comment documenting this exact gotcha.

**Fix:**
- If the DB is current but you still see this: log out / clear the
  `hearth_session` cookie (or just test in an incognito window) and log back
  in.
- If the DB predates the multi-tenancy migration (check: does `db:setup`
  print `CREATE TABLE` lines, or nothing, on a DB that already exists?):
  ```bash
  # stop `next dev` first — dropdb fails if anything holds a connection
  dropdb hearth && createdb hearth && npm run db:setup && npm run db:seed
  ```
  Then log in fresh (incognito first, to rule out cookie staleness) with one
  of the seeded demo accounts (see `npm run db:seed` output for the current
  list).

**Prevention (not yet done):** `scripts/db-setup.mjs` gives no signal when
`CREATE TABLE IF NOT EXISTS` no-ops against an outdated schema — it exits 0
either way. Worth making it detect "table exists but missing
`organization_id`" and fail loudly instead of leaving this to be debugged at
runtime again.

---

## Environment notes

- DB: local Postgres, connection string in `.env` as `DATABASE_URL`
  (`postgresql://najam@localhost:5432/hearth` by default).
- `npm run dev` — dev server. `npm run db:setup` — applies `db/schema.sql`
  (idempotent only for genuinely new tables, see above). `npm run db:seed` —
  wipes and reseeds demo data across two orgs (`org-hearth-demo`,
  `org-second-demo`) to exercise tenant isolation.
- No `app/error.js` error boundary and no `middleware.js`/`proxy.js` session
  validation yet — an unhandled server-side throw (like the one above) goes
  straight to the dev overlay / a raw 500, not a graceful redirect. Flagged
  as worth fixing before shipping the multi-tenancy change, since any
  already-logged-in user will hit incident #1 above the moment this ships.

---

## 2026-09-17 — `relation "organization_docusign_credentials" does not exist`

**Symptom:**
```
[browser] Uncaught error: relation "organization_docusign_credentials" does not exist
    at query (lib/db.js:21:15)
    at queryOne (lib/db.js:26:16)
    at getDocusignCredentials (lib/queries.js:499:15)
    at EsignSettingsPage (app/admin/esign/page.js:15:23)
```
On `GET /admin/esign`.

**Root cause:** `db/schema.sql` had a new table added
(`organization_docusign_credentials`, for the DocuSign e-signature feature)
without re-running `npm run db:setup` afterward. Unlike the 2026-09-16
incident, this was a genuinely *new* table (no existing table needed a
column retrofit), so no drop/recreate was needed — `CREATE TABLE IF NOT
EXISTS` just hadn't been asked to run since the table was added.

**Fix:**
```bash
npm run db:setup
```
Creates only the missing table(s), leaves existing data untouched.

**Note:** the same schema section (around `organization_docusign_credentials`)
also defines `organization_evv_credentials`, `service_authorizations`,
`billing_lines`, and `caregiver_orientations` — newer tables from the same
batch of feature work. If any of those throw the same "relation does not
exist" error, it's this same fix; running `db:setup` once should have
created all of them together already.

**Prevention reminder:** after adding any new table (or altering an
existing one) to `db/schema.sql`, run `npm run db:setup` immediately, before
the next `next dev` session — don't wait to hit the runtime error.

---

## 2026-09-17 — `EVV_CREDENTIALS_KEY is not set`

**Symptom:**
```
EVV_CREDENTIALS_KEY is not set. Generate one with: openssl rand -hex 32
```
Thrown from `lib/secrets.js` `getKey()`, hit via `encryptSecret()`/
`decryptSecret()` — so it can surface on any page that saves or reads an
encrypted credential (DocuSign settings, EVV settings).

**Root cause:** same pattern as the last two incidents — `.env.example` was
updated for new feature work (this time the AES-256-GCM secrets module
added for DocuSign/EVV credential encryption) but the real local `.env`
was never given an actual value for the new var.

**Fix:** generate and append a real key:
```bash
echo "EVV_CREDENTIALS_KEY=\"$(openssl rand -hex 32)\"" >> .env
```
then restart `next dev` (or reload — Next.js picks up `.env` changes in
dev in many cases, but restart if the error persists). Already done once
for this local environment as of this entry.

**Prevention reminder (recurring theme now — 3 incidents in 2 days):**
whenever `.env.example` gains a new variable, immediately add the real
value to `.env` in the same sitting — don't wait to hit the runtime error.
Same discipline as the `db:setup`-after-schema-change note above. Worth
considering a small startup check (e.g. in `lib/env.js`, checked once at
boot) that fails fast listing every var present in `.env.example` but
missing from `.env`, instead of surfacing one at a time as different pages
happen to be visited.

---

## 2026-09-17 — `caregiver_documents`/`caregiver_orientations` missing `signed_via`/`envelope_id`

**Symptom:** DocuSign-signing code paths (`actions/docusign.js`) referencing
`signed_via`/`envelope_id` on `caregiver_documents` or `caregiver_orientations`
fail because those columns don't exist on the local dev DB, even though
`db/schema.sql`'s `CREATE TABLE` statements for both tables already define
them correctly.

**Root cause:** the same recurring pattern (see 2026-09-16 entry) — both
tables predate this column being added to `schema.sql`, so
`CREATE TABLE IF NOT EXISTS` silently skips them on `db:setup`. `schema.sql`
itself is correct and needs no change; only the already-existing dev DB was
behind.

**Fix applied:** ran a one-off `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
+ `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT` patch script (not a
`dropdb`, since there was seeded data worth keeping this time). Confirmed
working as of this entry.

**This is now the 4th env/schema-drift incident in 2 days** (column
retrofit, missing table, missing env var, missing columns again). The
`lib/env.js` boot-check idea from the 2026-09-17 EVV_CREDENTIALS_KEY entry
would only catch the env-var case — for the schema-drift case specifically,
consider a real migrations tool (or at minimum a script that diffs
`information_schema.columns` against what `schema.sql` expects and fails
loudly) rather than continuing to hand-write one-off `ALTER TABLE` scripts
per incident.

---

## 2026-09-17 — DocuSign "stored private key could not be parsed" — RESOLVED

**Follow-up to the private-key entry above.** Root cause confirmed: `jose`'s
`importPKCS8()` only accepts PKCS#8-format PEM (`-----BEGIN PRIVATE
KEY-----`), but DocuSign's own RSA keypair generator (and a plain `openssl
genrsa`) commonly produce PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`), which
`importPKCS8` rejects even though the key itself is perfectly valid.

**Fix applied (code change, not a workaround):** `lib/docusign.js` now
parses the stored key with Node's native `crypto.createPrivateKey()`
instead of `jose`'s `importPKCS8`. Node's PEM parser auto-detects PKCS#1,
PKCS#8, and SEC1 formats, and `jose`'s `SignJWT.sign()` accepts a Node
`KeyObject` directly — so no format conversion is required from whoever
pastes the key into the UI going forward, for either format.

**Verified:** clicked "Test connection" on `/admin/esign` after the fix —
returned `Connected — account "silver Concepts LLC"` with a fresh
timestamp, using the same stored (previously-failing) credentials, no
re-paste needed.

---

## 2026-09-17 — `npm run db:seed` silently wipes DocuSign/EVV credentials

**Symptom:** after re-running `npm run db:seed`, a previously-connected
DocuSign (or EVV) connection disappears — `/admin/esign` shows "Not
connected" again, and any caregiver-facing signing button reverts to the
"the office will send these to you" fallback, with no error anywhere.

**Root cause:** `scripts/seed.mjs`'s `TRUNCATE` statement includes
`organizations ... CASCADE`. `organization_docusign_credentials` (and
`organization_evv_credentials`) have `organization_id` as a foreign key to
`organizations` with `ON DELETE CASCADE` — so truncating `organizations`
cascades into wiping those tables too, even though neither is named in the
`TRUNCATE` list. Not obvious from reading the script.

**Fix:** there isn't one to "recover" — the credentials are genuinely gone
and must be re-entered by hand in the admin UI (integration key, API
username, account ID, private key) after any full reseed.

**Worth fixing properly:** either stop including `organizations` in the
seed's `TRUNCATE` list (delete/reinsert just the rows that need reseeding,
leave org-level settings alone), or accept this as expected behavior and
document it loudly in `scripts/seed.mjs`'s own comments so it's not a
surprise — right now nothing in the script or its console output warns
that credentials will be lost.

---

## 2026-09-17 — Caregiver DocuSign signing flow: end-to-end test, PASSED

Full manual walkthrough of the onboarding-packet signing flow, done live
against the demo DocuSign account, as Thomas Grant (cg3):

1. `/caregiver/onboarding` → "Start signing" → real DocuSign envelope
   created via `createEnvelope`, embedded signing view opened
   (`createRecipientView`) with all 3 documents (Confidentiality & HIPAA,
   Employee Handbook, Hepatitis B) correctly pre-filled with signer name
   and date.
2. Signed all 3 documents in DocuSign's real embedded signing UI, adopted
   a signature, hit Finish.
3. DocuSign's own redirect back to
   `/caregiver/onboarding/sign/return?envelopeId=...&event=signing_complete`
   didn't fire automatically in this browser tooling environment (likely a
   cross-origin top-level-navigation quirk of the testing tool itself, not
   the app) — worked around by manually navigating to that same return URL
   with both required query params.
4. The route handler correctly re-verified the envelope's status via a
   fresh `getEnvelope()` API call (not trusting the redirect/event param
   alone) before calling `markPacketSigned`, exactly as designed. Result:
   "Sign your documents" flipped to "✓ All signed", progress 1/3 → correct.

**No app bug found in this flow.** Note for future manual testing: if the
automatic DocuSign→Hearth redirect doesn't fire in whatever browser you're
testing with, the return URL is safe to hit manually (envelopeId + event
must both be present) — it re-verifies against DocuSign rather than
trusting the URL, so this isn't a way to fake a signature.

---

## 2026-09-17 — "Start signing" silently does nothing (no error, no redirect)

**Symptom:** clicking "Start signing" on a caregiver's onboarding page
posts successfully (200, no thrown exception, no console error), but
nothing happens — no redirect to DocuSign, no error banner, URL stays
exactly `/caregiver/onboarding` with no query string.

**Root cause:** `startPacketSigningAction` (`actions/docusign.js`) has three
early guard clauses that each do a plain `redirect('/caregiver/onboarding')`
with no error param on failure — unlike the actual DocuSign-call failure
path, which redirects to `?esignError=1`. So a failure at one of these
guards is indistinguishable from "nothing happened" in the UI:
- `!session.caregiverId`
- `!credentials || credentials.status !== 'connected'`
- `!caregiver?.email`

In this case it was the third: `caregiver.email` was `null` because the
`caregivers` row had been inserted by an older run of `scripts/seed.mjs`,
before it started assigning real emails via `CAREGIVER_EMAILS` — stale
seed data, not a missing column (the `email` column existed the whole
time; `information_schema.columns` confirmed this before jumping to the
schema-drift explanation). Fixed by re-running `npm run db:seed`.

**Worth fixing:** these three guards give zero signal to whoever's
debugging it — consider having them redirect with a distinct
`?esignError=` reason code each (e.g. `no_caregiver`, `not_connected`,
`no_email`) instead of silently returning to a clean URL, so this class of
bug doesn't require re-deriving the cause from scratch next time.

---

## 2026-09-25 — QA `HARNESS ERROR: The clock-out must be after the clock-in` (qa-bill-hours)

**Symptom:** `run-qa.sh` fails only in the afternoon/evening, in the bill-hours suite.
**Root cause:** the test set the visit's clock-in timestamp to `now() - 2 days`, so the
clock-in carried the current time of day; after 11:00 AM the suite's `11:00` clock-out was
"before" it. Test bug, not an app bug.
**Fix:** pinned to 9:00 AM Central on the service date. Same commit made `run-qa.sh` resolve
a relative repo path (`./run-qa.sh .` used to create a dangling `node_modules` link and every
suite failed with `Cannot find package 'bcryptjs'`).

## 2026-09-25 — `"next start" does not work with "output: standalone"`

**Cause:** `next.config.mjs` now builds a standalone server (for Docker).
**Fix:** use `npm run build && npm start` — both scripts were updated (`start` runs
`.next/standalone/server.js`, `build` copies `public/` and `.next/static` into it).

## 2026-09-25 — `self-signed certificate in certificate chain` connecting to DigitalOcean Postgres

**Cause:** managed Postgres URLs end in `?sslmode=require`; the `pg` driver treats that as full
certificate verification, which fails against DigitalOcean's own CA.
**Fix (built in):** `lib/pg-config.js` turns sslmode into an explicit TLS setting — encrypted
always, certificate verified when `DATABASE_CA_CERT` holds the provider's CA certificate.

## 2026-09-25 — production server exits at startup with `[hearth] CONFIG ERROR: …`

**Cause:** deliberate — `instrumentation.js` refuses to start in production if
`DATABASE_URL`, `SESSION_SECRET` (32+ chars, not a placeholder such as "dev-only…" or
"replace-this…") or `EVV_CREDENTIALS_KEY` (64 hex) is missing or bad. The log names the
variable. In development the same problems are only warnings.

## 2026-09-25 — forgot-password / welcome email / sign-in code never arrives on the server

Check the app log at startup: `WARNING: Email is not connected …`. In production, with no email
provider, Hearth deliberately creates no reset links or codes and never prints them to the log
(anyone with log access could take over accounts). Connect a provider
(`.env.production.example`), restart, and use **Communications → Send test email**. Also check
`APP_BASE_URL` is set — without it no links are sent in production.
