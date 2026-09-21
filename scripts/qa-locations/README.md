# Locations / three-tier roles / referral intake — automated QA

187 assertions against the **real** `lib/queries.js` functions, running on a
**throwaway** Postgres database loaded from the **real** `db/schema.sql`.
Nothing here is mocked at the query layer, and your dev database is never
touched — the runner creates `hearth_qa_scratch`, uses it, and drops it.

## Run it

```bash
cd /Users/najam/claude_ihss/hearth-intake-app
bash scripts/qa-locations/run-qa.sh .
```

Needs `psql`/`createdb`/`dropdb` on PATH and a local Postgres you can create
databases in — the same one `npm run db:setup` talks to.

## What each file is

| File | What it does |
| --- | --- |
| `run-qa.sh` | Creates the scratch DB, loads `db/schema.sql`, rewrites the `@/lib/db` alias so plain node can import the query layer, runs all five suites (truncating between each), drops the DB. |
| `qa.mjs` | 81 assertions on the locations/franchise feature itself. |
| `qa-regression.mjs` | 25 assertions on the pre-existing EVV/billing behavior that now runs *through* the modified functions. |
| `qa-roles.mjs` | 34 assertions on the three-tier model: the `LOCATION_ADMIN` role, `createOrgUser`'s role/location contract, `getOrgStaff`, `updateLocation`, and reassigning a caregiver/client to a different location. |
| `qa-scoping.mjs` | 26 assertions on LOCATION_ADMIN read/write scoping — every reader a location admin's pages call narrows to one location, writers reject another tenant's location id, inactive locations are refused as a destination for new work. |
| `qa-referral-create.mjs` | 21 assertions on manual referral entry (`/referrals/new`) — required-field validation, tenant scoping, trimming, and that a manually-created referral flows into `submitIntake` exactly like a fax-sourced one. |
| `migration.sql` | The locations-feature migration for an existing dev database, verbatim from the SCHEMA DRIFT WARNING in `db/schema.sql`. Separate drift warnings for the other schema changes (the `LOCATION_ADMIN` CHECK constraint, `platform_admins.active`/`platform_role`) live directly in `db/schema.sql` — see the comments there. |

## Discipline this suite follows

Every suite goes through the real production writer functions, never raw
SQL, for any field being asserted on. This was learned the hard way: an
earlier version of `qa.mjs` inserted `rate_per_unit` via raw SQL, which
exercised the reader but never asked whether any writer could actually
populate the column — the suite was green while the commission feature was
completely dead. The rule now: never assert on a field the production writer
was never asked to write.

## Known gaps this suite cannot cover

- Action-level `locationId` pinning to `session.locationId` (in
  `addCaregiverAction`, `submitIntakeAction`, etc.) needs a real session and
  isn't exercised here — covered instead by a static page-by-page survey and
  by the ownership checks in the query layer underneath it.
- Fax/OCR intake is still deferred; `qa-referral-create.mjs` covers the
  manual entry point that stands in for it today, not automated extraction.
