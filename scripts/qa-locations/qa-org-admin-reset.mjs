// One-off QA helper (2026-09-21) — NOT part of the app, safe to delete after use.
//
// This session lost track of the ADMIN login for the multi-location test
// org created earlier in this QA pass (the one with Walter Higgins / Rosa
// Mendez / Houston Metro (Branch)). Finds that org via the "Houston Metro"
// location name, resets its ADMIN user's password to a known value (or
// creates one if none exists), and prints the email so QA of the two
// ADMIN-only pages (EVV sync log, franchise revenue rollup) can continue.
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as db from '../../lib/db.js';

const KNOWN_PASSWORD = 'QaAdmin2026!';

async function run() {
  const loc = await db.queryOne(
    `SELECT organization_id FROM locations WHERE name ILIKE '%Houston Metro%' LIMIT 1`
  );
  if (!loc) throw new Error('No location matching "Houston Metro" found.');
  const orgId = loc.organization_id;

  const hash = await bcrypt.hash(KNOWN_PASSWORD, 10);
  const existingAdmin = await db.queryOne(
    `SELECT id, email FROM users WHERE organization_id = $1 AND role = 'ADMIN' LIMIT 1`,
    [orgId]
  );

  if (existingAdmin) {
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, existingAdmin.id]);
    console.log(`Reset password for existing ADMIN: ${existingAdmin.email} / ${KNOWN_PASSWORD}  (org ${orgId})`);
  } else {
    const email = 'qa.admin@hearth.test';
    await db.query(
      `INSERT INTO users (id, organization_id, email, password_hash, name, role, caregiver_id)
       VALUES ($1,$2,$3,$4,$5,'ADMIN',NULL)`,
      [randomUUID(), orgId, email, hash, 'QA Org Admin']
    );
    console.log(`Created new ADMIN: ${email} / ${KNOWN_PASSWORD}  (org ${orgId})`);
  }
  await db.pool.end();
}

run().catch(async (e) => {
  console.error('ERROR:', e.message);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
