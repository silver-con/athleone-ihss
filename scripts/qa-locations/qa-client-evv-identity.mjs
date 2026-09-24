// QA for client EVV identity (2026-09-23): Medicaid ID / DOB / structured
// address on clients, captured at intake and editable afterwards, plus the
// format checks validateVisitPayload now runs before anything is sent to
// the aggregator. See project doc vesta-guides-production-gap-list.md,
// "Blockers" items 1 and 2.
import * as db from './queries.js';
import { query, pool } from './db.js';
import { buildVisitPayload, validateVisitPayload } from './evv-mapping.js';
import {
  normalizeMedicaidId, normalizeDob, normalizeState, normalizeZip, isValidNpi,
} from './client-identity.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
function throwsSync(name, fn, match) {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-id';
const OTHER = 'org-id2';

const REFERRAL = {
  payer: 'Molina Healthcare', clientName: 'Identity Client', dob: '04/18/1941',
  service: 'Personal Care Services', authHours: '10 hrs/wk', authNumber: 'MHC-9',
  diagnosis: 'Mobility impairment', receivedDate: '09/21/2026',
};

async function run() {
  console.log('\n== validators ==');
  eq('Medicaid ID with spaces/dashes is cleaned to 9 digits', normalizeMedicaidId(' 123-456 789 '), '123456789');
  eq('blank Medicaid ID is null (allowed at intake)', normalizeMedicaidId('  '), null);
  throwsSync('an 8-digit Medicaid ID is rejected', () => normalizeMedicaidId('12345678'), '9 digits');
  throwsSync('letters in a Medicaid ID are rejected', () => normalizeMedicaidId('12345678A'), '9 digits');
  eq('DOB MM/DD/YYYY becomes ISO', normalizeDob('4/8/1941'), '1941-04-08');
  eq('DOB from <input type=date> stays ISO', normalizeDob('1941-04-08'), '1941-04-08');
  throwsSync('Feb 30 is rejected', () => normalizeDob('02/30/1950'), 'real calendar date');
  throwsSync('a future DOB is rejected', () => normalizeDob('01/01/2999'), 'between 1900 and today');
  throwsSync('a free-text DOB is rejected', () => normalizeDob('April 1941'), 'like 04/18/1941');
  eq('state is upper-cased', normalizeState('tx'), 'TX');
  throwsSync('a spelled-out state is rejected', () => normalizeState('Texas'), '2-letter');
  eq('ZIP+4 accepted', normalizeZip('78550-1234'), '78550-1234');
  throwsSync('a 4-digit ZIP is rejected', () => normalizeZip('7855'), 'ZIP');
  check('CMS example NPI 1234567893 passes the check digit', isValidNpi('1234567893'));
  check('1234567890 fails the check digit', !isValidNpi('1234567890'));

  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Identity Agency','active'),($2,'Other Agency','active')`, [ORG, OTHER]);
  const loc = await db.createLocation(ORG, { name: 'Main' });
  const otherLoc = await db.createLocation(OTHER, { name: 'Main' });

  console.log('\n== submitIntake keeps the Medicaid ID, DOB and structured address (it used to drop them) ==');
  const r1 = await db.createReferral(ORG, REFERRAL);
  await db.submitIntake(ORG, r1, {
    clientName: 'Identity Client', dob: '04/18/1941', memberId: '123-456-789',
    address: '1605 W Tyler Ave', city: 'Harlingen', state: 'tx', zip: '78550',
    authHours: '10 hrs/wk', careNeeds: [], locationId: loc,
  });
  const c1 = (await db.getClients(ORG))[0];
  eq('medicaidId stored, cleaned', c1.medicaidId, '123456789');
  eq('dateOfBirth stored as ISO', c1.dateOfBirth, '1941-04-18');
  eq('addressLine1 stored', c1.addressLine1, '1605 W Tyler Ave');
  eq('city stored', c1.city, 'Harlingen');
  eq('state stored upper-cased', c1.state, 'TX');
  eq('zip stored', c1.zip, '78550');
  eq('display address composed from the parts', c1.address, '1605 W Tyler Ave, Harlingen, TX 78550');

  console.log('\n== a bad Medicaid ID at intake changes nothing ==');
  const r2 = await db.createReferral(ORG, { ...REFERRAL, clientName: 'Typo Client' });
  await throws('intake with a 5-digit Medicaid ID is refused', () => db.submitIntake(ORG, r2, {
    clientName: 'Typo Client', memberId: '12345', authHours: '10 hrs/wk', careNeeds: [], locationId: loc,
  }), '9 digits');
  eq('  ...the referral is NOT marked completed', (await db.getReferral(ORG, r2)).status, 'new');
  eq('  ...and no client was created', (await db.getClients(ORG)).length, 1);

  console.log('\n== intake without a Medicaid ID still works (referrals often arrive without one) ==');
  await db.submitIntake(ORG, r2, { clientName: 'Typo Client', authHours: '10 hrs/wk', careNeeds: [], locationId: loc });
  const c2 = (await db.getClients(ORG)).find((c) => c.name === 'Typo Client');
  eq('client created with medicaidId null', c2?.medicaidId, null);
  eq('  ...and the DOB falls back to the readable referral DOB', c2?.dateOfBirth, '1941-04-18');

  console.log('\n== a messy OCR referral DOB never blocks intake ==');
  const r3 = await db.createReferral(ORG, { ...REFERRAL, clientName: 'Messy DOB', dob: 'Apr 18 41' });
  await db.submitIntake(ORG, r3, { clientName: 'Messy DOB', authHours: '10 hrs/wk', careNeeds: [], locationId: loc });
  const c3 = (await db.getClients(ORG)).find((c) => c.name === 'Messy DOB');
  check('intake completed', Boolean(c3));
  eq('  ...with dateOfBirth left null for staff to fill in', c3?.dateOfBirth, null);

  console.log('\n== duplicate Medicaid IDs ==');
  const r4 = await db.createReferral(ORG, { ...REFERRAL, clientName: 'Duplicate' });
  await throws('the same Medicaid ID twice in one agency is refused with a readable message',
    () => db.submitIntake(ORG, r4, { clientName: 'Duplicate', memberId: '123456789', authHours: '1', careNeeds: [], locationId: loc }),
    'already has that Medicaid ID');
  eq('  ...and the referral was rolled back', (await db.getReferral(ORG, r4)).status, 'new');
  const rOther = await db.createReferral(OTHER, { ...REFERRAL, clientName: 'Other agency same ID' });
  await db.submitIntake(OTHER, rOther, { clientName: 'Other agency same ID', memberId: '123456789', authHours: '1', careNeeds: [], locationId: otherLoc });
  eq('a DIFFERENT agency can hold the same Medicaid ID (separate tenants)', (await db.getClients(OTHER))[0]?.medicaidId, '123456789');

  console.log('\n== the database itself refuses a malformed Medicaid ID ==');
  await throws('CHECK constraint rejects a direct write of a bad Medicaid ID',
    () => query(`UPDATE clients SET medicaid_id = 'ABC' WHERE organization_id = $1 AND id = $2`, [ORG, c1.id]));

  console.log('\n== updateClientEvvIdentity (care-plan page) ==');
  const changed = await db.updateClientEvvIdentity(ORG, c2.id, {
    medicaidId: '987654321', dateOfBirth: '1941-04-18', addressLine1: '12 Oak St', city: 'Austin', state: 'TX', zip: '78701',
  });
  eq('returns only the fields that changed (dob was already right)', changed, ['medicaidId', 'addressLine1', 'city', 'state', 'zip']);
  const c2b = await db.getClient(ORG, c2.id);
  eq('Medicaid ID saved', c2b.medicaidId, '987654321');
  eq('display address follows the structured fields', c2b.address, '12 Oak St, Austin, TX 78701');
  eq('saving the same values again reports no changes', await db.updateClientEvvIdentity(ORG, c2.id, {
    medicaidId: '987654321', dateOfBirth: '04/18/1941', addressLine1: '12 Oak St', city: 'Austin', state: 'tx', zip: '78701',
  }), []);
  await throws('a bad ZIP is refused', () => db.updateClientEvvIdentity(ORG, c2.id, { medicaidId: '987654321', zip: '1' }), 'ZIP');
  eq('  ...and the stored Medicaid ID is untouched', (await db.getClient(ORG, c2.id)).medicaidId, '987654321');
  await throws('taking another client\'s Medicaid ID is refused', () => db.updateClientEvvIdentity(ORG, c2.id, { medicaidId: '123456789' }), 'already has that Medicaid ID');
  await throws('another tenant cannot edit this client', () => db.updateClientEvvIdentity(OTHER, c2.id, { medicaidId: '111111111' }), 'not found');
  const otherLocInOrg = await db.createLocation(ORG, { name: 'Branch' });
  await throws('a location admin from a different location cannot edit this client',
    () => db.updateClientEvvIdentity(ORG, c2.id, { medicaidId: '111111111' }, otherLocInOrg), 'not found');

  console.log('\n== buildVisitPayload / validateVisitPayload ==');
  const credentials = { providerTaxId: '12-3456789', officeQualifier: 'NPI', officeIdentifier: '1234567893', payerId: 'P1' };
  const visit = {
    id: 'v1', serviceDate: '2026-09-14', start: '9:00 AM', end: '11:00 AM', caregiverId: 'cg1', status: 'completed',
    evv: { clockIn: '9:00 AM', clockOut: '11:00 AM' }, tasks: [],
  };
  const good = buildVisitPayload({ credentials, visit, client: c2b, caregiver: { id: 'cg1' }, authorization: { serviceCode: 's5125', modifierCodes: 'u3' }, state: 'TX' });
  eq('Member identifier is the Medicaid ID', good.Member.identifier, '987654321');
  eq('TIN sent as 9 digits (dash stripped)', good.providerTaxID, '123456789');
  eq('service code upper-cased', good.procedureCode, 'S5125');
  eq('modifiers upper-cased', good.procedureModifierCode, ['U3']);
  eq('a clean visit has no problems', validateVisitPayload(good), []);

  const noId = buildVisitPayload({ credentials, visit, client: { ...c2b, medicaidId: null, hhscIndividualNumber: 'DEMO-1' }, caregiver: { id: 'cg1' }, authorization: { serviceCode: 'S5125' }, state: 'TX' });
  eq('no Medicaid ID -> NO fallback to the HHSC number or internal client id', noId.Member.identifier, undefined);
  check('  ...and validation holds the visit back with a readable reason',
    validateVisitPayload(noId).some((p) => p.includes('no Medicaid ID on file')));

  const badCreds = buildVisitPayload({
    credentials: { ...credentials, providerTaxId: '1234', officeIdentifier: '1234567890' },
    visit, client: c2b, caregiver: { id: 'cg1' }, authorization: { serviceCode: 'PCS1', modifierCodes: 'U3X' }, state: 'TX',
  });
  const problems = validateVisitPayload(badCreds);
  check('a short TIN is flagged', problems.some((p) => p.includes('TIN')));
  check('an NPI with a bad check digit is flagged', problems.some((p) => p.includes('NPI')));
  check('a non-HCPCS service code is flagged', problems.some((p) => p.includes('not a valid HCPCS')));
  check('a 3-character modifier is flagged', problems.some((p) => p.includes('U3X')));
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`CLIENT EVV IDENTITY RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
