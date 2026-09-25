// Builds the `pg` connection config from DATABASE_URL. Shared by lib/db.js
// (the app) and scripts/migrate.mjs, so both treat TLS the same way.
//
// Why this exists: managed Postgres (DigitalOcean, Neon, Supabase…) hands
// you a URL ending in `?sslmode=require`. The `pg` driver parses that itself
// and — unlike psql — treats `require` as "verify the certificate against a
// public CA", which fails against DigitalOcean's self-signed database CA
// with "self-signed certificate in certificate chain". So the sslmode is
// taken out of the URL here and turned into an explicit `ssl` option:
//
//   no sslmode / disable      -> plain connection (local Postgres)
//   require / prefer          -> encrypted; certificate checked only if
//                                DATABASE_CA_CERT is set
//   verify-ca / verify-full   -> encrypted and certificate must check out
//                                (set DATABASE_CA_CERT to the provider's CA)
//
// DATABASE_CA_CERT is the CA certificate's PEM text (DigitalOcean: the
// database's "Download CA certificate"). PGSSLMODE overrides the URL.
// Plain JS with no '@/' imports so node scripts can load it directly.
export function pgConfig(env = process.env) {
  const raw = env.DATABASE_URL || '';
  let connectionString = raw;
  let mode = env.PGSSLMODE || '';
  try {
    const url = new URL(raw);
    mode = mode || url.searchParams.get('sslmode') || '';
    for (const p of ['sslmode', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(p);
    connectionString = url.toString();
  } catch {
    // Not a URL we can parse (e.g. a bare socket path) — hand it to pg as is.
  }
  const ca = env.DATABASE_CA_CERT ? env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : undefined;
  let ssl;
  if (['require', 'prefer', 'verify-ca', 'verify-full'].includes(mode)) {
    const verify = mode === 'verify-ca' || mode === 'verify-full' || Boolean(ca);
    ssl = { rejectUnauthorized: verify, ...(ca ? { ca } : {}) };
  }
  return { connectionString, ssl, max: Number(env.PG_POOL_MAX) || 10 };
}
