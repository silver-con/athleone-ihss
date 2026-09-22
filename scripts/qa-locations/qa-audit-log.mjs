// QA for the 2026-09-22 tenant-side audit trail: db.logAuditEvent /
// db.getAuditLog (lib/queries.js), org-scoping (no cross-tenant leakage),
// newest-first ordering, the location-name join, and the new
// admin.auditLog.view permission/route entry.
//
// Runs the REAL lib/queries.js functions against the throwaway QA
// database, same as the other suites here — see run-qa.sh.
import * as db from './queries.js';
import { query, pool } from './db.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ORG_A = 'org-audit-a';
const ORG_B = 'org-audit-b';

async function run() {
  console.log('\n== fixtures: two organizations, one with a location ==');
  await query(`INSERT INTO organizations (id, name, status) VALUES ($1,'Audit QA Agency A','active')`, [ORG_A]);
  await query(`INSERT INTO organizations (id, name, status) VALUES ($1,'Audit QA Agency B','active')`, [ORG_B]);
  const locA = await db.createLocation(ORG_A, { name: 'Loc A', commissionRate: 10 });

  console.log('\n== logAuditEvent writes a row for each of the three tracked areas ==');
  await db.logAuditEvent(ORG_A, {
    actorUserId: null,
    actorName: 'Jane Admin',
    actorRole: 'ADMIN',
    locationId: null,
    action: 'create_evv_credentials',
    entityType: 'evv_credentials',
    entityId: ORG_A,
    detail: 'client id changed; environment sandbox',
  });
  await new Promise((r) => setTimeout(r, 5)); // guarantee distinct created_at ordering
  await db.logAuditEvent(ORG_A, {
    actorUserId: null,
    actorName: 'Priya LocationAdmin',
    actorRole: 'LOCATION_ADMIN',
    locationId: locA,
    action: 'create_service_authorization',
    entityType: 'service_authorization',
    entityId: 'sa-1',
    detail: 'S5125 for client cl-1',
  });
  await new Promise((r) => setTimeout(r, 5));
  await db.logAuditEvent(ORG_A, {
    actorUserId: null,
    actorName: 'Coordinator Cara',
    actorRole: 'COORDINATOR',
    locationId: null,
    action: 'update_billing_line_status',
    entityType: 'billing_line',
    entityId: 'bl-1',
    detail: 'status -> paid',
  });
  // A row in the OTHER org, to prove getAuditLog never leaks across the
  // organization_id boundary.
  await db.logAuditEvent(ORG_B, {
    actorUserId: null,
    actorName: 'Someone Else',
    actorRole: 'ADMIN',
    locationId: null,
    action: 'create_evv_credentials',
    entityType: 'evv_credentials',
    entityId: ORG_B,
    detail: 'should never show up in org A\'s log',
  });

  console.log('\n== getAuditLog(orgA): all three org-A events, newest first, none of org B\'s ==');
  const logA = await db.getAuditLog(ORG_A);
  eq('exactly 3 rows for org A', logA.length, 3);
  eq('newest first — most recent action is the billing status change', logA[0].action, 'update_billing_line_status');
  eq('  ...then the care plan change', logA[1].action, 'create_service_authorization');
  eq('  ...then the EVV credentials change', logA[2].action, 'create_evv_credentials');
  check('no org-B row leaked into org A\'s log', !logA.some((r) => r.detail?.includes('should never show up')));

  console.log('\n== field mapping and the location-name join ==');
  const evvRow = logA.find((r) => r.entityType === 'evv_credentials');
  eq('actorName', evvRow.actorName, 'Jane Admin');
  eq('actorRole', evvRow.actorRole, 'ADMIN');
  eq('entityId', evvRow.entityId, ORG_A);
  eq('agency-wide row has no locationId', evvRow.locationId, null);
  eq('  ...and no locationName either', evvRow.locationName, null);

  const carePlanRow = logA.find((r) => r.entityType === 'service_authorization');
  eq('location-scoped row carries its locationId', carePlanRow.locationId, locA);
  eq('  ...and resolves the location\'s name via the join', carePlanRow.locationName, 'Loc A');

  console.log('\n== getAuditLog(orgB): only org B\'s own row ==');
  const logB = await db.getAuditLog(ORG_B);
  eq('exactly 1 row for org B', logB.length, 1);
  eq('it\'s org B\'s own event', logB[0].actorName, 'Someone Else');

  console.log('\n== lib/permissions.js: the new audit-log route is covered ==');
  const { PERMISSIONS, ROUTE_PERMISSIONS } = await import('./permissions.js');
  const match = ROUTE_PERMISSIONS.find((r) => r.test('/admin/audit-log'));
  check('a ROUTE_PERMISSIONS entry matches /admin/audit-log', Boolean(match));
  eq('  ...and it points at admin.auditLog.view specifically (not the /admin catch-all)', match?.key, 'admin.auditLog.view');
  check('  ...which exists in the permission catalog', Boolean(PERMISSIONS[match?.key]));
  eq('  ...restricted to ADMIN only, matching admin.evv.sync.view / admin.locations.view', PERMISSIONS[match?.key]?.roles?.join(','), 'ADMIN');
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`AUDIT LOG RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
