import { execSync } from 'child_process';

execSync(`psql "${process.env.DATABASE_URL}" -f db/schema.sql`, { stdio: 'inherit' });

// Applying schema.sql only creates brand-new tables (CREATE TABLE IF NOT
// EXISTS is a no-op against one that already exists) — it can silently
// fail to pick up a new column on an existing table. Check for that drift
// immediately, loudly, instead of waiting for a runtime crash on whichever
// page happens to touch the missing column first. See
// scripts/check-schema.mjs and docs/TROUBLESHOOTING.md for the history.
try {
  execSync('node --env-file=.env scripts/check-schema.mjs', { stdio: 'inherit' });
} catch {
  // check-schema.mjs has already printed exactly what drifted and how to
  // fix it — just carry its exit code up without burying that message
  // under a Node stack trace from execSync.
  process.exitCode = 1;
}
