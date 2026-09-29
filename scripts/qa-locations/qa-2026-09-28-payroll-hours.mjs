// QA for Payroll Hours (2026-09-28): pay periods, which visits count as
// verified, totals and variance, the 40-hour workweek check across a split
// pay period, tenant and location scoping, and the CSV. Fictional data.
import * as db from './queries.js';
import { query, pool } from './db.js';
import {
  payPeriodFor, previousPeriod, nextPeriod, resolvePayPeriod, periodLabel,
  lineState, workedMinutes, scheduledMinutes, buildPayrollReport, payrollCsv, CSV_COLUMNS,
} from './payroll-hours.js';
import { hasPermission, ROUTE_PERMISSIONS } from './permissions.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

const ORG = 'org-pay';
const OTHER = 'org-pay-2';
const TODAY = '2026-09-28';
// 9:00 AM Central in September = 14:00 UTC.
const ct = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), h + 5, m)).toISOString();
};
const label = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

async function visit(id, org, cg, client, date, start, end, { status = 'completed', resolved = true, verified = true, inAt = start, outAt = end, exception = null, billMinutes = null, authId = null } = {}) {
  const done = status === 'completed' || status === 'in-progress';
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved,
                         evv_clock_in, evv_clock_in_at, evv_clock_out, evv_clock_out_at, evv_verified, evv_exception, bill_minutes, service_authorization_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, org, cg, client, date, label(start), label(end), status, resolved,
      done ? label(inAt) : null, done ? ct(date, inAt) : null,
      status === 'completed' ? label(outAt) : null, status === 'completed' ? ct(date, outAt) : null,
      status === 'completed' && verified, exception, billMinutes, authId]
  );
}

async function run() {
  console.log('\n== pay periods ==');
  eq('1st–15th', payPeriodFor('2026-09-10'), { from: '2026-09-01', to: '2026-09-15', frequency: 'semimonthly' });
  eq('16th–end of a 30-day month', payPeriodFor('2026-09-20'), { from: '2026-09-16', to: '2026-09-30', frequency: 'semimonthly' });
  eq('16th–end of February', payPeriodFor('2027-02-16'), { from: '2027-02-16', to: '2027-02-28', frequency: 'semimonthly' });
  eq('16th–31st', payPeriodFor('2026-10-31').to, '2026-10-31');
  eq('weekly runs Monday–Sunday', payPeriodFor('2026-09-17', 'weekly'), { from: '2026-09-14', to: '2026-09-20', frequency: 'weekly' });
  eq('previous of 9/1–9/15 is 8/16–8/31', previousPeriod(payPeriodFor('2026-09-01')), { from: '2026-08-16', to: '2026-08-31', frequency: 'semimonthly' });
  eq('next of 12/16–12/31 is 1/1–1/15', nextPeriod(payPeriodFor('2026-12-20')), { from: '2027-01-01', to: '2027-01-15', frequency: 'semimonthly' });
  eq('?period= any day picks its period', resolvePayPeriod({ period: '2026-09-05' }).from, '2026-09-01');
  eq('a custom range is kept', resolvePayPeriod({ from: '2026-09-03', to: '2026-09-09' }), { from: '2026-09-03', to: '2026-09-09', frequency: 'custom' });
  eq('a custom range is capped at 62 days', resolvePayPeriod({ from: '2026-01-01', to: '2026-12-31' }).to, '2026-03-03');
  eq('a backwards or bad range falls back to the pay period', resolvePayPeriod({ from: '2026-09-09', to: '2026-09-01', period: '2026-09-02' }).frequency, 'semimonthly');
  eq('an unknown frequency falls back to twice a month', resolvePayPeriod({ freq: 'hourly', period: '2026-09-02' }).frequency, 'semimonthly');
  eq('label', periodLabel({ from: '2026-09-01', to: '2026-09-15' }), '9/1/2026 – 9/15/2026');

  console.log('\n== fixtures ==');
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Pay Agency','active'), ($2,'Other Agency','active')`, [ORG, OTHER]);
  const north = await db.createLocation(ORG, { name: 'North' });
  const south = await db.createLocation(ORG, { name: 'South' });
  await query(
    `INSERT INTO caregivers (id, organization_id, name, role, phone, status, location_id) VALUES
       ('p-cg1',$1,'Ana North','Attendant','5550000001','active',$2),
       ('p-cg2',$1,'Ben South','Attendant','5550000002','active',$3),
       ('p-cg3',$4,'Eve Elsewhere','Attendant','5550000003','active',NULL)`,
    [ORG, north, south, OTHER]
  );
  await query(
    `INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, location_id, medicaid_id) VALUES
       ('p-c1',$1,'=Pat Formula','Molina','29','09/01/2026',$2,'999000501'),
       ('p-c2',$1,'Quinn Client','Molina','45','09/01/2026',$3,'999000502'),
       ('p-c3',$4,'Other Client','Molina','10','09/01/2026',NULL,'999000503')`,
    [ORG, north, south, OTHER]
  );
  await query(
    `INSERT INTO service_authorizations (id, organization_id, client_id, payer, service_code, service_description, modifier_codes, start_date, end_date, status) VALUES
       ('p-a1',$1,'p-c1','Molina','S5125','PAS attendant care','U5','2026-09-01','2027-08-31','approved'),
       ('p-a2',$1,'p-c2','Molina','S5125 U5','PAS attendant care',NULL,'2026-09-01','2027-08-31','approved')`,
    [ORG]
  );
  // Ana (North): the two visits from the real log, plus every kind of problem.
  await visit('p-v1', ORG, 'p-cg1', 'p-c1', '2026-09-14', '09:00', '15:00');
  await visit('p-v2', ORG, 'p-cg1', 'p-c1', '2026-09-15', '09:00', '15:00', { inAt: '09:05', outAt: '15:20' });
  await visit('p-v3', ORG, 'p-cg1', 'p-c1', '2026-09-10', '09:00', '13:00', { resolved: false, exception: '110A' });
  await visit('p-v4', ORG, 'p-cg1', 'p-c1', '2026-09-11', '09:00', '13:00', { status: 'scheduled' });
  await visit('p-v5', ORG, 'p-cg1', 'p-c1', '2026-09-12', '09:00', '13:00', { status: 'missed' });
  await visit('p-v6', ORG, 'p-cg1', 'p-c1', '2026-09-13', '09:00', '13:00', { status: 'in-progress' });
  await visit('p-v7', ORG, 'p-cg1', 'p-c1', '2026-09-09', '09:00', '15:00', { outAt: '14:30', billMinutes: 300, authId: 'p-a1' });
  await visit('p-v8', ORG, 'p-cg1', 'p-c1', '2026-09-08', '09:00', '13:00', { outAt: '08:30' }); // clock-out before clock-in
  await visit('p-v9', ORG, 'p-cg1', 'p-c1', '2026-09-16', '09:00', '15:00'); // next pay period
  // Ben (South): 9 hours a day Mon 9/14 – Fri 9/18 = 45 hrs in one workweek,
  // two days of it in the 9/1–9/15 period.
  for (const [i, d] of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].entries()) {
    await visit(`p-b${i}`, ORG, 'p-cg2', 'p-c2', d, '08:00', '17:00');
  }
  await visit('p-x1', OTHER, 'p-cg3', 'p-c3', '2026-09-14', '09:00', '15:00');

  const period = payPeriodFor('2026-09-10');
  const span = { from: '2026-08-31', to: '2026-09-20' }; // the workweeks the period touches
  const { rows, auths } = await db.getPayrollVisits(ORG, span);
  const report = buildPayrollReport({ rows, auths, period, today: TODAY });
  const ana = report.attendants.find((a) => a.caregiverId === 'p-cg1');
  const ben = report.attendants.find((a) => a.caregiverId === 'p-cg2');
  const line = (id) => report.attendants.flatMap((a) => a.lines).find((l) => l.visitId === id);

  console.log('\n== which visits count ==');
  eq('a completed, verified visit counts', line('p-v1').state, 'verified');
  eq('an open EVV exception does not count yet', line('p-v3').state, 'exception');
  eq('a past visit with no clock-in does not count', line('p-v4').state, 'not_clocked');
  eq('a missed visit does not count', line('p-v5').state, 'missed');
  eq('clocked in but never out does not count', line('p-v6').state, 'in_progress');
  eq('a clock-out before the clock-in is flagged', line('p-v8').state, 'bad_times');
  eq('a future scheduled visit is "not happened yet"', lineState({ status: 'scheduled', serviceDate: '2026-10-01' }, TODAY), 'upcoming');
  check('the next pay period\'s visit is left out', !line('p-v9'));
  eq('visits needing a fix are counted', report.summary.needsAttention, 4);

  console.log('\n== hours, totals and variance ==');
  eq('scheduled 9:00–3:00 = 6.00 hrs', scheduledMinutes(rows.find((r) => r.visit.id === 'p-v1').visit), 360);
  eq('verified hrs come from the clock timestamps (9:05–3:20)', line('p-v2').verifiedMinutes, 375);
  eq('a 110 B visit: verified 5.5, bill 5, marked adjusted', [line('p-v7').verifiedMinutes, line('p-v7').billMinutes, line('p-v7').adjusted], [330, 300, true]);
  eq('bill code and modifier from the authorization', [line('p-v1').serviceCode, line('p-v1').modifiers], ['S5125', 'U5']);
  eq('  ...also when the modifier is written inside the code', [line('p-b0').serviceCode, line('p-b0').modifiers], ['S5125', 'U5']);
  eq("Ana's totals: 3 verified visits, 18.00 scheduled, 17.75 verified", [ana.totals.visits, ana.totals.scheduledMinutes, ana.totals.verifiedMinutes], [3, 1080, 1065]);
  eq("  ...variance -0.25 hrs", ana.totals.varianceMinutes, -15);
  eq("  ...bill hrs 17.00", ana.totals.billMinutes, 1020);
  eq('the log example: two 6-hour visits = 12.00 / 12.00, variance 0', (() => {
    const two = buildPayrollReport({ rows: rows.filter((r) => ['p-v1'].includes(r.visit.id) || r.visit.id === 'p-b0'), auths, period, today: TODAY });
    return two.attendants.find((a) => a.caregiverId === 'p-cg1').totals.varianceMinutes;
  })(), 0);
  check('workedMinutes falls back to the labels on older visits', workedMinutes({ evv: { clockIn: '9:00 AM', clockOut: '3:00 PM' } }) === 360);
  check('a visit past midnight is counted forward', scheduledMinutes({ start: '10:00 PM', end: '2:00 AM' }) === 240);

  console.log('\n== 40-hour workweek ==');
  eq("Ben's pay-period hours are only 9/14 and 9/15", ben.totals.verifiedMinutes, 18 * 60);
  const wk = ben.weeks.find((w) => w.monday === '2026-09-14');
  eq('  ...but his whole week 9/14–9/20 is 45 hrs', wk?.minutes, 45 * 60);
  eq('  ...5 hrs over 40, flagged, and marked as a split week', [wk?.overtimeMinutes, ben.overtime, wk?.partial], [300, true, true]);
  check("Ana isn't flagged", !ana.overtime);
  eq('one attendant over 40', report.summary.overtimeAttendants, 1);

  console.log('\n== scoping ==');
  check("another agency's visits never appear", !rows.some((r) => r.visit.id === 'p-x1') && !report.attendants.some((a) => a.caregiverId === 'p-cg3'));
  const northOnly = await db.getPayrollVisits(ORG, span, north);
  check('a location admin sees only their own attendants', northOnly.rows.length > 0 && northOnly.rows.every((r) => r.visit.caregiverId === 'p-cg1'));
  eq('authorizations are only those for the clients shown', [...new Set(northOnly.auths.map((a) => a.id))], ['p-a1']);
  eq('an empty range is fine', (await db.getPayrollVisits(ORG, { from: '2025-01-01', to: '2025-01-15' })).rows.length, 0);
  check('an agency id is required', await db.getPayrollVisits(null, span).then(() => false, () => true));

  console.log('\n== CSV ==');
  const csv = payrollCsv(report);
  const lines = csv.trim().split('\r\n');
  eq('header', lines[0], CSV_COLUMNS.join(','));
  eq('one row per verified visit plus a total per attendant', lines.length, 1 + 3 + 1 + 2 + 1);
  check('no Medicaid IDs in the file', !/99900050/.test(csv));
  check('a client name starting with "=" is made safe', csv.includes("'=Pat Formula") && !/,=Pat/.test(csv));
  check('a negative variance stays a number', lines.some((l) => l.endsWith(',-0.25')));
  check('the total row carries the totals', lines.some((l) => l.includes('Ana North — TOTAL') && l.includes(',18.00,17.75,17.00,-0.25')));
  check('unverified visits are not in the file', !csv.includes('p-v3') && !csv.includes('p-v4') && !csv.includes('p-v6'));

  console.log('\n== access ==');
  eq('who can open it', ['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR', 'CAREGIVER'].map((r) => hasPermission(r, 'admin.payroll.view')), [true, true, false, false]);
  const key = (p) => ROUTE_PERMISSIONS.find((r) => r.test(p))?.key;
  eq('the page and the CSV use the payroll permission', [key('/admin/payroll'), key('/admin/payroll/export')], ['admin.payroll.view', 'admin.payroll.view']);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`PAYROLL HOURS RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
