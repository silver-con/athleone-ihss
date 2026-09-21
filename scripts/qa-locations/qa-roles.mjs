// QA for the three-tier model: platform -> organization -> location.
// Covers the new LOCATION_ADMIN role, org staffing, location config, and
// location reassignment — against the real query layer on a real Postgres.
import * as db from './queries.js';
import { query, pool } from './db.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, expectMatch) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!expectMatch || msg.includes(expectMatch)),
    msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-t';
const OTHER = 'org-u';

async function run() {
  await query(
    `INSERT INTO organizations (id,name,status) VALUES ($1,'Tier Agency','active'),($2,'Other Agency','active')`,
    [ORG, OTHER]
  );

  console.log('\n== the users.role CHECK constraint accepts LOCATION_ADMIN ==');
  const loc = await db.createLocation(ORG, { name: 'Alpha Branch', commissionRate: 15 });
  const other = await db.createLocation(OTHER, { name: 'Foreign Branch', commissionRate: 5 });

  const laId = await db.createOrgUser(ORG, {
    name: 'Alpha Manager', email: 'alpha.mgr@x.test', passwordHash: 'h',
    role: 'LOCATION_ADMIN', locationId: loc,
  });
  check('a LOCATION_ADMIN row inserts without a constraint violation', typeof laId === 'string');
  const laRow = await query('SELECT role, location_id FROM users WHERE id = $1', [laId]);
  eq('  ...stored with the new role', laRow[0].role, 'LOCATION_ADMIN');
  eq('  ...and scoped to its location', laRow[0].location_id, loc);

  console.log('\n== createOrgUser enforces the role/location contract ==');
  await throws('LOCATION_ADMIN without a location is refused',
    () => db.createOrgUser(ORG, { name: 'X', email: 'x1@x.test', passwordHash: 'h', role: 'LOCATION_ADMIN' }),
    'must be assigned to a location');
  await throws('ADMIN scoped to a location is refused',
    () => db.createOrgUser(ORG, { name: 'Y', email: 'y1@x.test', passwordHash: 'h', role: 'ADMIN', locationId: loc }),
    'cannot be scoped');
  await throws('a location from ANOTHER organization is refused',
    () => db.createOrgUser(ORG, { name: 'Z', email: 'z1@x.test', passwordHash: 'h', role: 'LOCATION_ADMIN', locationId: other }),
    'Location not found');
  await throws('an unsupported role is refused',
    () => db.createOrgUser(ORG, { name: 'W', email: 'w1@x.test', passwordHash: 'h', role: 'PLATFORM_ADMIN' }),
    'unsupported role');
  await throws('CAREGIVER cannot be created through the staff path',
    () => db.createOrgUser(ORG, { name: 'V', email: 'v1@x.test', passwordHash: 'h', role: 'CAREGIVER' }),
    'unsupported role');

  const adminId = await db.createOrgUser(ORG, {
    name: 'Org Boss', email: 'boss@x.test', passwordHash: 'h', role: 'ADMIN',
  });
  const coordId = await db.createOrgUser(ORG, {
    name: 'Front Desk', email: 'desk@x.test', passwordHash: 'h', role: 'COORDINATOR', locationId: loc,
  });
  check('an org ADMIN with no location is accepted', typeof adminId === 'string');
  check('a COORDINATOR may optionally be scoped to a location', typeof coordId === 'string');

  console.log('\n== getOrgStaff lists office accounts only ==');
  // A caregiver login must NOT appear in the staff list.
  await db.createCaregiverWithLogin(ORG, {
    name: 'Field CG', role: 'Aide', phone: '1', email: 'cg@x.test', passwordHash: 'h', locationId: loc,
  });
  const staff = await db.getOrgStaff(ORG);
  eq('three office accounts', staff.length, 3);
  check('caregiver logins are excluded', !staff.some((s) => s.role === 'CAREGIVER'));
  const mgr = staff.find((s) => s.id === laId);
  eq('the location name is joined in for display', mgr.locationName, 'Alpha Branch');
  eq('an org admin shows no location', staff.find((s) => s.id === adminId).locationName, null);
  eq('staff is tenant-scoped', (await db.getOrgStaff(OTHER)).length, 0);

  console.log('\n== updateLocation configures a location after creation ==');
  await db.updateLocation(ORG, loc, { name: 'Alpha Branch (renamed)', commissionRate: 22.5, status: 'inactive' });
  const updated = await db.getLocation(ORG, loc);
  eq('name updated', updated.name, 'Alpha Branch (renamed)');
  eq('commission rate updated', updated.commissionRate, 22.5);
  eq('status updated to inactive', updated.status, 'inactive');
  await db.updateLocation(ORG, loc, { commissionRate: 10 });
  const partial = await db.getLocation(ORG, loc);
  eq('a partial update leaves other fields alone', partial.name, 'Alpha Branch (renamed)');
  eq('  ...and applies the one field given', partial.commissionRate, 10);
  await throws('updating another organization\'s location is refused',
    () => db.updateLocation(ORG, other, { name: 'hijacked' }), 'Location not found');
  eq('  ...and the foreign location is untouched', (await db.getLocation(OTHER, other)).name, 'Foreign Branch');
  await throws('a commission rate above 100 is still rejected by the CHECK',
    () => db.updateLocation(ORG, loc, { commissionRate: 130 }));

  console.log('\n== reassignment rescues rows that predate locations ==');
  // A caregiver and client with NO location, as every pre-existing row has.
  const strandedCg = await db.createCaregiverWithLogin(ORG, {
    name: 'Legacy CG', role: 'Aide', phone: '2', email: 'legacy@x.test', passwordHash: 'h',
  });
  await query(
    `INSERT INTO referrals (id,organization_id,payer,client_name,dob,service,auth_hours,auth_number,diagnosis,received_date,status)
     VALUES ('tr1',$1,'Medicaid','Legacy Client','01/01/1950','PAS','10','A','DX','09/01/2026','new')`, [ORG]
  );
  await db.submitIntake(ORG, 'tr1', { clientName: 'Legacy Client', authHours: '10 hrs/wk', careNeeds: [] });
  const strandedCl = 'c-tr1';

  eq('the legacy caregiver starts with no location', (await db.getCaregiver(ORG, strandedCg)).locationId, null);
  eq('the legacy client starts with no location', (await db.getClient(ORG, strandedCl)).locationId, null);

  await db.setCaregiverLocation(ORG, strandedCg, loc);
  eq('setCaregiverLocation assigns the caregiver', (await db.getCaregiver(ORG, strandedCg)).locationId, loc);
  const cgUser = await query('SELECT location_id FROM users WHERE caregiver_id = $1', [strandedCg]);
  eq('  ...and their LOGIN is moved too, not just the HR row', cgUser[0].location_id, loc);

  await db.setClientLocation(ORG, strandedCl, loc);
  eq('setClientLocation assigns the client', (await db.getClient(ORG, strandedCl)).locationId, loc);

  await throws('reassigning into another organization\'s location is refused',
    () => db.setCaregiverLocation(ORG, strandedCg, other), 'Location not found');
  eq('  ...leaving the caregiver where they were', (await db.getCaregiver(ORG, strandedCg)).locationId, loc);
  await throws('same for a client',
    () => db.setClientLocation(ORG, strandedCl, other), 'Location not found');

  await db.setCaregiverLocation(ORG, strandedCg, null);
  eq('clearing a location back to null is allowed', (await db.getCaregiver(ORG, strandedCg)).locationId, null);

  console.log('\n== a location admin\'s scoped reads still hold ==');
  const inLoc = await db.getCaregivers(ORG, loc);
  check('scoped read returns only that location\'s caregivers',
    inLoc.every((c) => c.locationId === loc), JSON.stringify(inLoc.map((c) => c.locationId)));
  eq('a scoped read cannot see the other tenant', (await db.getCaregivers(OTHER, loc)).length, 0);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`ROLE/TIER RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
