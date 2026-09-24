// QA for visit locations (2026-09-24, Vesta "Community Location" parity):
// where the caregiver says they are at clock-in/out, distance from the
// client's home, learning/setting/clearing the home location, the agency's
// "at home" radius setting, and scoping.
import * as db from './queries.js';
import { query, pool } from './db.js';
import { distanceFeet, parseLatLng, formatDistance, mapLink, isVisitLocation } from './geo.js';
import { todayIso } from './calendar.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
function near(name, a, e, tol) { check(name, typeof a === 'number' && Math.abs(a - e) <= tol, `expected ~${e} (±${tol}), got ${a}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-loc';
const OTHER = 'org-loc2';
const HOME = { lat: 26.075175, lng: -97.473486 };
// 0.001 degrees of longitude at this latitude is ~328 ft.
const east = (deg, accuracy = 10) => ({ lat: HOME.lat, lng: HOME.lng + deg, accuracy });

async function addVisit(id, clientId = 'c-loc') {
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status)
     VALUES ($1,$2,'cg-loc',$3,$4,'12:01 AM','11:59 PM','scheduled')`,
    [id, ORG, clientId, todayIso()]
  );
}

async function run() {
  console.log('\n== geo helpers ==');
  near('0.001° of longitude at 26°N is ~328 ft', distanceFeet(HOME.lat, HOME.lng, HOME.lat, HOME.lng + 0.001), 328, 2);
  eq('same point is 0 ft', distanceFeet(HOME.lat, HOME.lng, HOME.lat, HOME.lng), 0);
  eq('an invalid coordinate gives no distance', distanceFeet(91, 0, 0, 0), null);
  eq('parses "lat, lng"', parseLatLng(' 26.075175 , -97.473486 '), HOME);
  eq('parses a Google Maps link', parseLatLng('https://www.google.com/maps/@26.075175,-97.473486,17z'), HOME);
  eq('rejects junk', parseLatLng('Harlingen TX'), null);
  eq('rejects out-of-range', parseLatLng('95.1, 10'), null);
  eq('short distances in feet', formatDistance(180.4), '180 ft');
  eq('long distances in miles', formatDistance(246957), '47 mi');
  check('map link built from coordinates', /maps\?q=26\.075175,-97\.473486/.test(mapLink(HOME.lat, HOME.lng)));
  check('five Vesta categories are recognised', ['member_home', 'family_home', 'neighbor_home', 'community', 'other'].every(isVisitLocation));
  check('anything else is not', !isVisitLocation('moon'));

  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Loc Agency','active'),($2,'Other','active')`, [ORG, OTHER]);
  const north = await db.createLocation(ORG, { name: 'North' });
  const south = await db.createLocation(ORG, { name: 'South' });
  await query(`INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES ('cg-loc',$1,'Cam','Aide','5550000000','active',$2)`, [ORG, north]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ('c-loc',$1,'Cora','Molina','10','09/01/2026',$2)`, [ORG, north]);
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id) VALUES ('c-loc2',$1,'Cal','Molina','10','09/01/2026',$2)`, [ORG, north]);
  const actor = { userId: null, name: 'Olive Office', role: 'ADMIN', locationId: null };

  console.log('\n== clock-in with no GPS / an inaccurate fix ==');
  await addVisit('lv1');
  await db.clockIn(ORG, 'lv1', null, null, 'member_home');
  let v = await db.getVisit(ORG, 'lv1');
  eq('location category recorded even without GPS', v.evv.clockInLocation, 'member_home');
  eq('  ...no distance without GPS', v.evv.clockInDistanceFt, null);
  eq("  ...and the client's home is not learned", (await db.getClient(ORG, 'c-loc')).homeLat, null);
  await addVisit('lv2');
  await db.clockIn(ORG, 'lv2', null, east(0, 200), 'member_home');
  eq('an inaccurate fix (200 m) does not teach the home location', (await db.getClient(ORG, 'c-loc')).homeLat, null);

  console.log('\n== learning the home location ==');
  await addVisit('lv3');
  await db.clockIn(ORG, 'lv3', null, east(0, 12), 'member_home');
  let c = await db.getClient(ORG, 'c-loc');
  eq('an accurate "client\'s home" clock-in learns the home location', [c.homeLat, c.homeLng], [HOME.lat, HOME.lng]);
  eq('  ...marked as learned', c.homeLocationSource, 'learned');
  check('  ...noting which visit it came from', /lv3/.test(c.homeLocationSetBy || ''), c.homeLocationSetBy);
  eq('  ...and that clock-in is 0 ft from home', (await db.getVisit(ORG, 'lv3')).evv.clockInDistanceFt, 0);
  await addVisit('lv3b', 'c-loc2');
  await db.clockIn(ORG, 'lv3b', null, east(0.01, 5), 'community');
  eq('an accurate COMMUNITY clock-in does not teach a home location', (await db.getClient(ORG, 'c-loc2')).homeLat, null);

  console.log('\n== distance from home ==');
  await addVisit('lv4');
  await db.clockIn(ORG, 'lv4', null, east(0.003, 8), 'community');
  v = await db.getVisit(ORG, 'lv4');
  eq('community clock-in recorded', v.evv.clockInLocation, 'community');
  near('  ...~984 ft from home', v.evv.clockInDistanceFt, 984, 5);
  await db.clockOut(ORG, 'lv4', null, east(0.0012, 8), 'member_home');
  v = await db.getVisit(ORG, 'lv4');
  eq('clock-out location recorded separately', v.evv.clockOutLocation, 'member_home');
  near('  ...~394 ft from home (beyond the default 250 ft radius)', v.evv.clockOutDistanceFt, 394, 5);
  eq('  ...clock-in location kept', v.evv.clockInLocation, 'community');
  await addVisit('lv5');
  await db.clockIn(ORG, 'lv5', null, east(0.0002, 3), 'member_home');
  eq('a second accurate home clock-in does NOT move the learned home', (await db.getClient(ORG, 'c-loc')).homeLng, HOME.lng);
  near('  ...it just measures ~66 ft from it', (await db.getVisit(ORG, 'lv5')).evv.clockInDistanceFt, 66, 3);
  await addVisit('lv6');
  await db.clockIn(ORG, 'lv6', null, null, 'moon');
  eq('an unknown category falls back to the client\'s home', (await db.getVisit(ORG, 'lv6')).evv.clockInLocation, 'member_home');
  await throws('the database refuses an invalid category written directly',
    () => query(`UPDATE visits SET evv_clock_in_location = 'moon' WHERE id = 'lv6'`));
  await db.clockIn(ORG, 'lv6', null, east(0.001), 'family_home');
  v = await db.getVisit(ORG, 'lv6');
  eq('clocking in again resets the clock-out location', [v.evv.clockInLocation, v.evv.clockOutLocation], ['family_home', null]);

  console.log('\n== staff setting the home location ==');
  await throws('bad coordinates are refused', () => db.setClientHomeLocation(ORG, 'c-loc2', { lat: 200, lng: 0 }, actor), 'valid latitude');
  await db.setClientHomeLocation(ORG, 'c-loc2', { lat: 30.2672, lng: -97.7431 }, actor);
  c = await db.getClient(ORG, 'c-loc2');
  eq('entered by staff', [c.homeLat, c.homeLng, c.homeLocationSource, c.homeLocationSetBy], [30.2672, -97.7431, 'entered', 'Olive Office']);
  const before4 = (await db.getVisit(ORG, 'lv4')).evv.clockInDistanceFt;
  const clientId = await db.setClientHomeFromVisit(ORG, 'lv4', 'in', actor);
  c = await db.getClient(ORG, 'c-loc');
  eq("taking a visit's clock-in as home returns the client", clientId, 'c-loc');
  eq('  ...uses that clock-in\'s coordinates', c.homeLng, HOME.lng + 0.003);
  eq('  ...marked as from a visit', c.homeLocationSource, 'from_visit');
  eq('  ...and past visits keep the distance they showed at the time', (await db.getVisit(ORG, 'lv4')).evv.clockInDistanceFt, before4);
  await throws('a clock event with no GPS cannot be used', () => db.setClientHomeFromVisit(ORG, 'lv1', 'in', actor), 'no GPS');
  await throws('a location admin elsewhere cannot use this visit', () => db.setClientHomeFromVisit(ORG, 'lv4', 'in', actor, south), 'Visit not found');
  await throws('another agency cannot use this visit', () => db.setClientHomeFromVisit(OTHER, 'lv4', 'in', actor), 'Visit not found');
  await throws('another agency cannot set this client\'s home', () => db.setClientHomeLocation(OTHER, 'c-loc', HOME, actor), 'Client not found');
  await db.clearClientHomeLocation(ORG, 'c-loc');
  c = await db.getClient(ORG, 'c-loc');
  eq('clearing removes the home location', [c.homeLat, c.homeLocationSource], [null, null]);
  await addVisit('lv7');
  await db.clockIn(ORG, 'lv7', null, east(0.0005, 9), 'member_home');
  eq('  ...so the next accurate home clock-in learns it again', (await db.getClient(ORG, 'c-loc')).homeLng, HOME.lng + 0.0005);

  console.log('\n== "at home" radius setting ==');
  let org = await db.getOrganization(ORG);
  eq('defaults to 250 ft', org.homeRadiusFeet, 250);
  const base = { flexibleHoursEnabled: false, graceMinutes: 20, maintenanceWindowDays: '' };
  await throws('below 50 ft is refused', () => db.updateOrganizationEvvSettings(ORG, { ...base, homeRadiusFeet: 49 }), 'between 50 and 2,000');
  await throws('above 2,000 ft is refused', () => db.updateOrganizationEvvSettings(ORG, { ...base, homeRadiusFeet: 2001 }), 'between 50 and 2,000');
  await db.updateOrganizationEvvSettings(ORG, { ...base, homeRadiusFeet: 300 });
  eq('300 ft is saved', (await db.getOrganization(ORG)).homeRadiusFeet, 300);
  await db.updateOrganizationEvvSettings(ORG, base);
  eq('leaving it out keeps the saved value', (await db.getOrganization(ORG)).homeRadiusFeet, 300);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`VISIT LOCATIONS RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
