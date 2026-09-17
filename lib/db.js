// Postgres access via the `pg` driver directly (no ORM — see the README's
// "Why no Prisma" note). One pooled connection shared across the app,
// reused across hot-reloads in dev the same way you'd memoize a Prisma
// client singleton.
import { Pool } from 'pg';

const globalForDb = globalThis;

export const pool =
  globalForDb.__hearthPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__hearthPool = pool;
}

// Thin helper: run a query, return just the rows.
export async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}
