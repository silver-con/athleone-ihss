// Health check for DigitalOcean / Docker / uptime monitors. Public, no PHI:
// says whether the app is up and can reach its database, nothing else.
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return Response.json({ ok: true, db: 'up', ms: Date.now() - started }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, db: 'down' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
