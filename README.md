# Hearth — IHSS Caregiver Agency App

A full-stack Next.js app for one caregiver agency's data, with **three
perspectives** and real per-role login:

- **Intake Portal** — an intake coordinator processes referrals from health
  plans/hospitals (including a mocked-up incoming fax) and completes client
  intake.
- **Admin Dashboard** — agency-wide KPIs and charts, a caregiver roster,
  caseload assignment, a weekly visit schedule, an EVV (Electronic Visit
  Verification) compliance log, and a Texas EVV Compliance Center.
- **Caregiver App** — a mobile-style companion app for a field caregiver:
  their visit schedule with EVV clock-in/out, a per-visit care plan
  checklist, messages with the office, and their client profiles.

All three read and write the same **Postgres database** — an action in one
(a caregiver clocking out on their app, an admin reassigning a caseload)
is immediately visible to the others, because it's the same rows, not
shared browser state.

## Architecture

- **Next.js 16** (App Router, Turbopack), React 19. Every page that reads
  data is a **Server Component** that queries Postgres directly; every
  mutation (clock in/out, assign a caregiver, submit an intake, send a
  message, …) is a **Server Action** in `actions/*.js`.
- **Postgres**, accessed with the plain [`pg`](https://node-postgres.com/)
  driver and hand-written SQL (`lib/db.js`, `lib/queries.js`) — see "Why no
  ORM" below.
- **Authentication** is hand-rolled: `bcryptjs` for password hashing, a
  signed JWT session cookie via `jose`, and `proxy.js` (Next 16's renamed
  `middleware.js` convention) enforcing which routes each role can reach.
  There's no NextAuth/Auth.js — Next 16 is new enough that a large auth
  library felt like a bigger compatibility risk than the ~150 lines of
  session code in `lib/auth.js` / `lib/session.js`.

### Why no ORM (Prisma)

The first pass at this used Prisma. Prisma's CLI downloads its query/schema
engine binaries from `binaries.prisma.sh` on `npm install` / `migrate dev` —
in the sandbox this was built in, that host was blocked by network policy,
so the Prisma-based build could never actually be run or tested there.
Rather than ship ORM code that had never been verified end-to-end, the app
was rebuilt on the `pg` driver directly: zero binary downloads, works
anywhere Postgres does, and every query in `lib/queries.js` has actually
been exercised against a real database. If you'd rather use Prisma (or
Drizzle) in your own fork, `db/schema.sql` is a straightforward starting
point to translate into a schema file.

## Getting started

Requires Node.js 18.18+ (Node 20+ recommended) and a Postgres database —
either a local install or a free hosted one (Supabase, Neon, Railway all
work; any Postgres does).

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure your database.** Copy `.env.example` to `.env` and fill in
   `DATABASE_URL` with your Postgres connection string, and set
   `SESSION_SECRET` to a long random string (used to sign login sessions).

   ```bash
   cp .env.example .env
   ```

3. **Create the tables:**

   ```bash
   npm run db:setup
   ```

   This runs `db/schema.sql` against `$DATABASE_URL` with `psql`. If you
   don't have `psql` installed locally, paste the contents of
   `db/schema.sql` into your database provider's SQL console instead.

4. **Seed sample data and demo logins:**

   ```bash
   npm run db:seed
   ```

   This loads the same sample referrals/clients/caregivers/visits the
   original prototype used, plus one login per role (see table below).
   Re-running it resets everything back to that starting point.

5. **Run the app:**

   ```bash
   npm run dev
   ```

   Open **http://localhost:3000** — a landing page with three cards, one
   per perspective above. Each requires signing in as that role.

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Intake coordinator | `coordinator@hearth.demo` | `coordinator123` |
| Admin | `admin@hearth.demo` | `admin123` |
| Caregiver — Maria Alvarez | `maria@hearth.demo` | `caregiver123` |
| Caregiver — Denise Okoye | `denise@hearth.demo` | `caregiver123` |
| Caregiver — Thomas Grant | `thomas@hearth.demo` | `caregiver123` |
| Caregiver — Priya Subramaniam | `priya@hearth.demo` | `caregiver123` |
| Admin, second tenant (isolation check) | `admin@secondagency.demo` | `admin123` |

These are seed data for trying the app out, not production credentials —
change or remove them (`scripts/seed.mjs`) before using this anywhere real.

### Multi-tenancy

Hearth is a multi-tenant SaaS platform — every table carries an
`organization_id`, every session carries the signed-in user's
`organizationId`, and every function in `lib/queries.js` requires it as its
first argument and filters on it. The `admin@secondagency.demo` login above
belongs to a second, separate seeded organization specifically so you can
confirm two tenants never see each other's clients, caregivers, or visits.
See the **IHSS** project's `multitenant-hhaexchange-architecture-spec.md`
and `client-systems-gap-discovery.md` docs for the full design rationale,
the Texas HHAeXchange EVV integration plan, and the compliance/handoff
brief for a senior developer's review.

## Workflow to try

**Intake coordinator side** — sign in as `coordinator@hearth.demo`:

1. The inbox at `/referrals` — referrals from Molina Healthcare, Anthem
   Blue Cross and a hospital discharge team, with status badges and stat
   counts.
2. Click **View** on the Molina Healthcare / Eleanor Whitfield row, then
   **View original referral fax** to see a mocked-up fax cover sheet +
   authorization letter.
3. Back on that referral, click **Start Intake** to open the full intake
   form — client info, payer/authorization, emergency contact, physician,
   a care-needs checklist, and consent.
4. Check consent and click **Submit Intake** — the referral flips to
   "Completed" (in the database) and the new client appears on `/clients`.

**Admin side** — sign in as `admin@hearth.demo`:

5. **`/admin`** — KPIs and charts, plus a "Needs attention" panel
   surfacing unassigned clients, caregivers on leave, and open EVV
   exceptions.
6. **`/admin/caregivers`** — roster; click a status pill to toggle Active /
   On leave.
7. **`/admin/clients`** — assign/reassign each client's caregiver from a
   dropdown.
8. **`/admin/schedule`** — a Mon–Sun grid of every caregiver's visits.
   Click any visit to see its details, including EVV data once started.
9. **`/admin/evv`** — this week's EVV compliance log: KPI tiles, a
   visits-by-status chart, and every occurred visit's clock-in/out, method
   and any flagged exception (a real Texas HHSC reason code, e.g. "210 —
   No electronic clock in/out"). Click **Mark reviewed** to acknowledge one.
10. **`/admin/compliance`** — the **Texas EVV Compliance Center**: the
    agency's quarterly EVV Usage Score against HHSC's 80% minimum, the
    3-tier enforcement ladder, the 6 EVV data elements required by the
    federal Cures Act, a **visit maintenance queue** sorted by urgency
    against Texas's 95-day correction window, and a **Submit VMUR** action
    once a visit is past that window.

**Caregiver app** — sign in as `denise@hearth.demo` (she has an
in-progress visit today):

11. **Schedule** tab — today's visits with a **Clock In** button; tap a
    visit for its detail page.
12. On a visit's detail page — **Clock In** / **Clock Out**, and check off
    the **care plan checklist** as tasks are completed during the visit.
13. **Messages** tab — a thread with the office; send a reply.
14. **Clients** tab — the caregiver's own caseload; tap one for contact
    info, care needs, and visit history.
15. Clock out on a visit, then sign out and sign back in as
    `admin@hearth.demo` and open **EVV Compliance** — that visit shows as
    "Completed", verified. Same database, three perspectives.

## Project structure

```
app/
  layout.js                        Root layout (fonts, global styles)
  page.js                          Landing page — links to all three sections
  login/                           Sign-in page + form
  (dashboard)/
    layout.js                      Sidebar + page shell (intake side) + sign-out
    referrals/page.js              Referral inbox
    referrals/[id]/page.js         Referral detail
    referrals/[id]/intake/         Intake form (Server Action submit)
    clients/page.js                Client roster (coordinator view)
  fax/[id]/page.js                 Standalone mocked referral fax document
  admin/
    layout.js                      Admin sidebar + page shell + sign-out
    page.js                        Admin overview (KPIs + charts)
    caregivers/page.js             Caregiver roster
    clients/page.js                Agency-wide clients + caregiver assignment
    schedule/page.js               Weekly caregiver visit schedule
    evv/page.js                    This week's EVV compliance log
    compliance/page.js             Texas EVV Compliance Center
  caregiver/
    layout.js                      Phone-frame shell + bottom tab nav + sign-out
    schedule/page.js               Caregiver's own visits + clock in
    visit/[id]/page.js             Visit detail — EVV clock in/out + checklist
    messages/page.js               Message thread with the office
    clients/page.js                Caregiver's own client caseload
actions/
  auth.js                          Login/logout Server Actions, requireSession()
  referrals.js                     Submit intake
  admin.js                         Assign caregiver, toggle status, resolve/VMUR
  caregiver.js                     Clock in/out, toggle task, send message
lib/
  db.js                            pg Pool + query helpers
  queries.js                       All SQL — reads and writes, one place
  auth.js                          bcrypt hashing, session cookie read/write
  session.js                       JWT sign/verify (used by proxy.js too)
  data.js                          Seed data + static reference constants
                                    (Texas EVV figures, week layout, etc.)
  styles.js                        Shared payer/status/caregiver/visit color lookups
db/schema.sql                      Postgres table definitions
scripts/seed.mjs                   Loads seed data + demo logins into Postgres
proxy.js                           Route protection by session + role (Next 16's
                                    renamed middleware.js convention)
components/                        Shared UI (StatTile, charts, Toast, per-role
                                    interactive bits under admin/ and caregiver/)
```

## Notes

- Styled with Tailwind CSS v4 (utility classes) plus a small set of CSS
  custom properties in `app/globals.css` for the color palette.
- Nunito (headings) and Karla (body) load from Google Fonts at runtime via
  a `<link>` tag, so the build itself never needs network access — if the
  machine running it is offline, the UI just falls back to system fonts.
- The charts are hand-built with plain HTML/CSS (no charting library).
- All client, payer, caregiver and case data (Eleanor Whitfield, Jamie
  Reyes RN, Molina Healthcare, Maria Alvarez, etc.) is fictional sample
  data for demonstration only.
- The schedule/EVV data models a fixed demo week (Mon 9/14–Sun 9/20, with
  Tue 9/15 treated as "today") rather than the actual current date, so the
  mix of completed/in-progress/missed/scheduled visits stays the same no
  matter when you run this. Re-running `npm run db:seed` resets to that
  starting point.
- Sessions are a signed JWT in an httpOnly cookie, valid 7 days. There's no
  password reset, email verification, or account self-service — this is a
  demo auth system, not a production-ready one. Rotate `SESSION_SECRET`
  and the demo passwords before using this anywhere beyond a prototype.

## Deploying

You'll need your own Postgres instance in production (this can't provision
one for you) — Supabase, Neon, Railway, or a managed Postgres from any
cloud provider all work. Point `DATABASE_URL` at it, set a real
`SESSION_SECRET`, run `npm run db:setup` once against it, seed or
hand-create your real users, then `npm run build && npm run start` (or
deploy to your platform of choice — this is a standard Next.js app with no
platform-specific dependencies).

## Texas EVV compliance modeling — sources & confidence

The Compliance Center's numbers are modeled on the published Texas HHSC
Electronic Visit Verification Policy Handbook, not invented:

- **The 6 required data elements** — federal 21st Century Cures Act, Sec.
  12006(a)(5)(A)(i)–(vi). High confidence, verbatim from
  medicaid.gov's EVV requirements documentation.
- **HHAeXchange as Texas's state EVV aggregator**, with an "open vendor"
  option for agencies using their own EVV Proprietary System — HHSC EVV
  Policy Handbook §4000/§5000. High confidence.
- **95-day visit maintenance window** before a visit locks and needs a
  Visit Maintenance Unlock Request (VMUR) — HHSC EVV Policy Handbook §9000.
  High confidence as the *currently published* figure, but HHSC revises
  this handbook periodically (there's a January 2026 revisions document we
  could not fully verify at build time) — re-check the live handbook before
  treating 95 as fixed.
- **80% minimum quarterly EVV Usage Score**, with a 3-tier enforcement
  ladder (training → Corrective Action Plan → possible termination over a
  rolling 24 months) — HHSC EVV Policy Handbook §11000. High confidence,
  with one caveat: a secondary source referenced a possible *temporary*
  HHSC reduction to this threshold at some point, which we could not
  confirm either way — verify the current number is still 80% before
  relying on it.
- **Reason codes** (000, 110A–C, 120, 130, 210/210I, 310, 600) — the
  *current*, consolidated code set effective since August 2023, per TMHP's
  published EVV Proprietary Systems appendix. An older, more granular
  pre-2023 code list still circulates online and is deprecated — don't use
  it as current. The exact sub-code wording in HHSC's live "Appendix I"
  table could not be fully verified at build time, so treat the labels here
  as representative rather than a legal copy of the handbook text.

None of this is legal or compliance advice — it's a good-faith model of
public HHSC policy for prototyping purposes. Before this shapes any real
agency's process, verify every figure against the live handbook at
hhs.texas.gov and fhb.hhs.texas.gov.
