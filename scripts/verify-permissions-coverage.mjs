// Static verification: every page.js / route.js under app/ must either be
// one of the three known-public routes, or resolve to a permission key via
// lib/permissions.js's ROUTE_PERMISSIONS table — and that key must actually
// exist in PERMISSIONS. Run with `node scripts/verify-permissions-coverage.mjs`.
//
// This is the automated check behind the claim in the access-control map
// that every route in the app is accounted for — not just the ones someone
// remembered to test by hand.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_PERMISSIONS, PERMISSIONS, PUBLIC_ROUTES } from '../lib/permissions.js';

const APP_DIR = path.join(process.cwd(), 'app');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry === 'page.js' || entry === 'route.js') {
      out.push(full);
    }
  }
  return out;
}

// Turn a file path like app/admin/caregivers/[id]/page.js into a sample
// URL path like /admin/caregivers/sample-id — route groups (dashboard)
// are stripped since they don't appear in the URL, and dynamic segments
// get a placeholder value so the regexes in ROUTE_PERMISSIONS (which all
// match on [^/]+) resolve the same way a real id would.
function toUrlPath(filePath) {
  const rel = path.relative(APP_DIR, filePath).replace(/\\/g, '/');
  const withoutFile = rel.replace(/\/(page|route)\.js$/, '');
  const segments = withoutFile
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => (/^\[.+\]$/.test(s) ? 'sample-id' : s));
  return '/' + segments.join('/');
}

const files = walk(APP_DIR);
const publicPaths = new Set(PUBLIC_ROUTES.map((r) => toUrlPath(path.join(APP_DIR, r.route.replace(/^app\//, '')))));

let problems = 0;
for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  const urlPath = toUrlPath(file);

  if (publicPaths.has(urlPath)) continue;

  const match = ROUTE_PERMISSIONS.find((r) => r.test(urlPath));
  if (!match) {
    console.error(`NO ROUTE_PERMISSIONS MATCH: ${rel}  (tested as ${urlPath})`);
    problems++;
    continue;
  }
  if (!PERMISSIONS[match.key]) {
    console.error(`ROUTE_PERMISSIONS POINTS AT UNKNOWN KEY "${match.key}": ${rel}`);
    problems++;
  }
}

// Also flag any 'page' permission in the catalog whose route file doesn't
// actually exist any more (stale entry).
for (const [key, entry] of Object.entries(PERMISSIONS)) {
  if (entry.kind !== 'page' && entry.kind !== 'route') continue;
  const routes = entry.route.split(', ').map((r) => path.join(process.cwd(), r));
  for (const r of routes) {
    try {
      statSync(r);
    } catch {
      console.error(`CATALOG ENTRY "${key}" POINTS AT MISSING FILE: ${entry.route}`);
      problems++;
    }
  }
}

if (problems === 0) {
  console.log(`OK — all ${files.length} page.js/route.js files under app/ are accounted for (public or permission-mapped), and every catalog route file exists.`);
  process.exit(0);
} else {
  console.error(`${problems} problem(s) found.`);
  process.exit(1);
}
