// Schema-drift check: parses db/schema.sql for every CREATE TABLE IF NOT
// EXISTS block, extracts the columns it expects, and compares that against
// what information_schema actually reports for the live database.
//
// Why this exists: CREATE TABLE IF NOT EXISTS is a no-op against a table
// that already exists — so if a column gets added to schema.sql for a
// table that predates it, `npm run db:setup` silently does nothing for
// that table and the app doesn't find out until something crashes at
// runtime (see docs/TROUBLESHOOTING.md — this happened three times in two
// days before this check existed). This script makes that drift loud and
// immediate instead.
//
// Run with: npm run db:check  (also runs automatically at the end of
// `npm run db:setup`, see scripts/db-setup.mjs)
import { readFileSync } from 'fs';

// Lines inside a CREATE TABLE block that start with one of these are
// table-level constraints, not columns — e.g. `UNIQUE (caregiver_id,
// doc_type)`. Without this, "UNIQUE" gets parsed as a column name and then
// reported as permanently missing from the database.
const CONSTRAINT_KEYWORDS = new Set([
  'unique',
  'primary',
  'foreign',
  'check',
  'constraint',
  'exclude',
  'like',
]);

export function parseExpectedSchema(sql) {
  const tables = new Map();
  // Anchored at the start of a line (no leading `--`) so this doesn't match
  // the line in schema.sql's own trailing comment that mentions this exact
  // phrase in prose.
  const tableBlockRe = /^CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/gm;
  let match;
  while ((match = tableBlockRe.exec(sql))) {
    const [, tableName, body] = match;
    const columns = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('--')) continue;
      const columnMatch = line.match(/^([a-z_][a-z0-9_]*)\s+\S/i);
      if (!columnMatch) continue;
      if (CONSTRAINT_KEYWORDS.has(columnMatch[1].toLowerCase())) continue;
      columns.push(columnMatch[1]);
    }
    tables.set(tableName, columns);
  }
  return tables;
}

async function main() {
  const { pool } = await import('../lib/db.js');
  const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const expected = parseExpectedSchema(sql);

  const { rows: existingTables } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const existing = new Set(existingTables.map((r) => r.table_name));

  const { rows: allColumns } = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const actualByTable = new Map();
  for (const { table_name, column_name } of allColumns) {
    if (!actualByTable.has(table_name)) actualByTable.set(table_name, new Set());
    actualByTable.get(table_name).add(column_name);
  }

  const problems = [];
  for (const [table, columns] of expected) {
    if (!existing.has(table)) {
      problems.push(`  ✗ table "${table}" does not exist at all — expected columns: ${columns.join(', ')}`);
      continue;
    }
    const actual = actualByTable.get(table) || new Set();
    const missing = columns.filter((c) => !actual.has(c));
    if (missing.length) {
      problems.push(`  ✗ table "${table}" is missing column(s): ${missing.join(', ')}`);
    }
  }

  await pool.end();

  if (problems.length) {
    console.error('\nSchema drift detected — db/schema.sql expects things the live database does not have:\n');
    console.error(problems.join('\n'));
    console.error(
      '\nCREATE TABLE IF NOT EXISTS only creates brand-new tables — it never adds a column to a table that ' +
      'already exists. See db/schema.sql\'s "NOTE ON MIGRATING AN EXISTING DEV DATABASE" comment, or ' +
      'docs/TROUBLESHOOTING.md, for how to fix each case (an ALTER TABLE patch when there is data worth ' +
      'keeping, or dropdb + recreate for throwaway local/dev data).\n'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Schema check OK — ${expected.size} tables in db/schema.sql all match the live database.`);
}

// Only run against the database when executed directly, so the parser above
// can be imported and unit-tested without needing a live connection.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Schema check failed to run:', err.message);
    process.exitCode = 1;
  });
}
