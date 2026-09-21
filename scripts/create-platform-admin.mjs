// Creates one row in platform_admins — the only way to create a platform
// admin account. There is deliberately no signup page, invite flow, or
// admin-UI button for this (see db/schema.sql's comment on
// platform_admins and architecture spec §3): this role can see every
// tenant's data, so provisioning it is a thing a person with real
// database access does on purpose, not a form anyone can submit.
//
// Run with:
//   npm run platform:create-admin -- --email=ops@hearth.example --name="Jane Ops" --password="..." --role=full
//
// --role is optional and defaults to "full" (same default the
// platform_admins.platform_role column itself has — see db/schema.sql —
// so this script's existing behavior is unchanged if you omit it). Pass
// --role=support to provision a view-only platform admin instead; see
// app/platform/admins for what each level can and can't do.
//
// (loads .env automatically via --env-file, same as scripts/seed.mjs)
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, queryOne } from '../lib/db.js';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || '').trim().toLowerCase();
  const name = String(args.name || '').trim();
  const password = String(args.password || '');
  const platformRole = String(args.role || 'full').trim();

  if (!email || !name || !password) {
    console.error(
      'Usage: npm run platform:create-admin -- --email=ops@hearth.example --name="Jane Ops" --password="..." [--role=full|support]'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (!['support', 'full'].includes(platformRole)) {
    console.error('--role must be "support" or "full".');
    process.exit(1);
  }

  const existing = await queryOne('SELECT id FROM platform_admins WHERE email = $1', [email]);
  if (existing) {
    console.error(`A platform admin with that email already exists (id: ${existing.id}).`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO platform_admins (id, email, password_hash, name, platform_role) VALUES ($1, $2, $3, $4, $5)`,
    [id, email, passwordHash, name, platformRole]
  );

  console.log(`Created platform admin "${name}" <${email}> (id: ${id}, role: ${platformRole}).`);
  console.log('They can sign in at /login with this email and password — same form as everyone else.');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create platform admin:', err);
  process.exit(1);
});
