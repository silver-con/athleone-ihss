// One command that brings ANY Hearth database up to date — a brand-new
// empty one on a DigitalOcean droplet, or your existing local dev database.
//
//   npm run db:migrate            apply everything that's pending
//   npm run db:migrate -- --status   list what's applied / pending, change nothing
//
// How it works:
//
// 1. db/schema.sql is applied first. Every statement in it is
//    CREATE ... IF NOT EXISTS, so on a fresh database it builds the whole
//    current schema, and on an existing one it only adds brand-new tables.
//
// 2. A `schema_migrations` table records which migrations have run.
//
// 3. FRESH database (no organizations table before step 1): schema.sql
//    already produced the final shape, so every known migration is recorded
//    as applied without running it (a "baseline").
//
//    EXISTING database: every migration not yet recorded is run, in order —
//    first the older one-off scripts (scripts/migrate-2026-09-*.mjs, all
//    idempotent), then the plain-SQL files in db/migrations/ (each in its own
//    transaction).
//
// 4. scripts/check-schema.mjs runs last and fails loudly if any column in
//    schema.sql is still missing from the live database.
//
// Adding a schema change from now on: put the final shape in db/schema.sql
// (so fresh installs get it) AND add db/migrations/<date>-<n>-<name>.sql
// with the ALTER/CREATE for existing databases. Nothing else to register.
//
// Reads DATABASE_URL from the environment. Locally the npm script passes
// --env-file=.env; in Docker/DigitalOcean the platform sets it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { pgConfig } from '../lib/pg-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The one-off scripts written before this runner existed, in the order they
// have to run. Never reorder or remove entries — only append (and prefer a
// .sql file in db/migrations/ for anything new).
export const LEGACY_SCRIPTS = [
  'migrate-2026-09-17.mjs',
  'migrate-2026-09-21-multi-state.mjs',
  'migrate-2026-09-22-audit-log.mjs',
  'migrate-2026-09-22-visit-service-authorization.mjs',
  'migrate-2026-09-22-evv-geolocation.mjs',
  'migrate-2026-09-23-flexible-hours.mjs',
  'migrate-2026-09-23-client-evv-identity.mjs',
  'migrate-2026-09-23-access-control.mjs',
  'migrate-2026-09-23-visit-maintenance.mjs',
  'migrate-2026-09-24-visit-locations.mjs',
  'migrate-2026-09-24-evv-export-hold.mjs',
  'migrate-2026-09-24-bill-hours.mjs',
  'migrate-2026-09-24-overlap-check.mjs',
];

export function sqlMigrationFiles(dir = path.join(ROOT, 'db', 'migrations')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function allMigrationIds() {
  return [...LEGACY_SCRIPTS.map((f) => `legacy/${f}`), ...sqlMigrationFiles().map((f) => `sql/${f}`)];
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Locally, put it in .env; on a server, set it in the environment.');
    process.exit(1);
  }

  const client = new pg.Client(pgConfig());
  await client.connect();

  const hadOrganizations = (
    await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations'`)
  ).rowCount === 1;

  const hadLedger = (
    await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'`)
  ).rowCount === 1;

  if (statusOnly) {
    const applied = hadLedger ? new Set((await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id)) : new Set();
    console.log(hadOrganizations ? 'Existing Hearth database.' : 'Empty database — `npm run db:migrate` will build it from db/schema.sql.');
    for (const id of allMigrationIds()) console.log(`  ${applied.has(id) ? 'applied' : 'PENDING'}  ${id}`);
    await client.end();
    return;
  }

  console.log('==> Applying db/schema.sql (creates any table that does not exist yet)');
  const schemaSql = readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  let schemaDeferred = false;
  try {
    await client.query(schemaSql);
  } catch (err) {
    // On an existing database schema.sql can fail if it indexes a column
    // that a pending migration hasn't added yet. Run the migrations first,
    // then apply schema.sql again (below). A fresh database has no excuse.
    if (!hadOrganizations) throw err;
    console.log(`    schema.sql needs a pending migration first (${err.message}) — running migrations, then retrying.`);
    schemaDeferred = true;
  }

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));

  if (!hadOrganizations) {
    // Fresh database: schema.sql is already the final shape.
    const ids = allMigrationIds().filter((id) => !applied.has(id));
    for (const id of ids) await client.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    console.log(`==> Fresh database: built from schema.sql, ${ids.length} migration(s) recorded as already applied.`);
  } else {
    let ran = 0;
    for (const file of LEGACY_SCRIPTS) {
      const id = `legacy/${file}`;
      if (applied.has(id)) continue;
      console.log(`==> Running ${id}`);
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', file)], {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        console.error(`\n${id} failed (exit ${r.status}). Nothing after it was run. Fix the error above and re-run npm run db:migrate.`);
        await client.end();
        process.exit(1);
      }
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      ran++;
    }
    for (const file of sqlMigrationFiles()) {
      const id = `sql/${file}`;
      if (applied.has(id)) continue;
      console.log(`==> Running ${id}`);
      const sql = readFileSync(path.join(ROOT, 'db', 'migrations', file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`\n${id} failed and was rolled back: ${err.message}\nNothing after it was run.`);
        await client.end();
        process.exit(1);
      }
      ran++;
    }
    console.log(ran ? `==> ${ran} migration(s) applied.` : '==> Already up to date — nothing to run.');
    if (schemaDeferred) {
      console.log('==> Applying db/schema.sql again');
      await client.query(schemaSql);
    }
  }
  await client.end();

  console.log('==> Checking the live database against db/schema.sql');
  const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-schema.mjs')], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  process.exit(check.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
