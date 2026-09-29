// QA for payroll pay (2026-09-28): pay rates, straight-time pay, the
// weighted-average overtime premium paid in the period the workweek ends,
// missing rates, approving / locking / reopening a pay period, changes after
// approval, tenant isolation and the CSVs. Fictional data.
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { buildPayrollReport, payPeriodFor, payrollCsv, CSV_COLUMNS, CSV_PAY_COLUMNS } from './payroll-hours.js';
import {
  parseRate, rateFor, money, addPay, approvalBlockers, buildSnapshot, changesSinceApproval,
  payrollSummaryCsv, SUMMARY_COLUMNS,
} from './payroll-pay.js';
import { loadPayrollReport } from './payroll-report.js';
import { hasPermission, ROUTE_PERMISSIONS } from './permissions.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-pp';
const OTHER = 'org-pp-2';
const TODAY = '2026-10-05';
const ADMIN = { userId: null, name: 'Olive Admin', role: 'ADMIN' };
const ct = (date, hhmm) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 5, m)).toISOString();
};
const label = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
async function visit(id, cg, client, date, start, end, org = ORG) {
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, service_date, start_time, end_time, status, resolved,
                         evv_clock_in, evv_clock_in_at, evv_clock_out, evv_clock_out_at, evv_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',true,$6,$8,$7,$9,true)`,
    [id, org, cg, client, date, label(start), label(end), ct(date, start), ct(date, end)]
  );
}
async function report(period, today = TODAY) {
  const { addDays, mondayOf } = await import('./calendar.js');
  const { rows, auths } = await db.getPayrollVisits(ORG, { from: mondayOf(period.from), to: addDays(mondayOf(period.to), 6) });
  const rates = await db.getPayRates(ORG);
  return addPay(buildPayrollReport({ rows, auths, period, today }), { rows, rates, today });
}
const att = (r, id) => r.attendants.find((a) => a.caregiverId === id);

async function run() {
  console.log('\n== rates ==');
  eq('"12.50" -> 1250 cents', parseRate('12.50'), 1250);
  eq('"$15" -> 1500 cents', parseRate('$15'), 1500);
  await throws('below the minimum wage is refused', () => parseRate('7.00'), 'minimum wage');
  await throws('an absurd rate is refused', () => parseRate('600'), 'above');
  await throws('three decimals are refused', () => parseRate('12.505'), 'like 12.50');
  await throws('text is refused', () => parseRate('twelve'), 'like 12.50');
  const rs = [{ caregiverId: 'a', clientId: null, rateCents: 1200 }, { caregiverId: 'a', clientId: 'x', rateCents: 1400 }];
  eq('a client rate wins over the default', rateFor(rs, 'a', 'x'), { rateCents: 1400, source: 'client' });
  eq('otherwise the default', rateFor(rs, 'a', 'y'), { rateCents: 1200, source: 'default' });
  eq('no rate at all -> null', rateFor(rs, 'b', 'x'), null);
  eq('money format', [money(123456), money(0), money(null)], ['$1,234.56', '$0.00', '—']);

  console.log('\n== fixtures ==');
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Pay Agency','active'), ($2,'Other Agency','active')`, [ORG, OTHER]);
  await query(
    `INSERT INTO caregivers (id, organization_id, name, role, phone, status) VALUES
       ('pp-a',$1,'Ana Two-Rates','Attendant','1','active'), ('pp-b',$1,'Ben Split-Week','Attendant','2','active'),
       ('pp-c',$1,'Cal No-Rate','Attendant','3','active'),   ('pp-d',$1,'Dee Early-Week','Attendant','4','active'),
       ('pp-z',$2,'Zed Elsewhere','Attendant','5','active')`,
    [ORG, OTHER]
  );
  await query(
    `INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date) VALUES
       ('pp-x',$1,'Xena Client','Molina','40','09/01/2026'), ('pp-y',$1,'Yuri Client','Molina','40','09/01/2026'),
       ('pp-q',$2,'Other Client','Molina','10','09/01/2026')`,
    [ORG, OTHER]
  );
  await db.setPayRate(ORG, { caregiverId: 'pp-a', rateCents: 1200 }, ADMIN);
  await db.setPayRate(ORG, { caregiverId: 'pp-a', clientId: 'pp-x', rateCents: 1400 }, ADMIN);
  await db.setPayRate(ORG, { caregiverId: 'pp-b', rateCents: 900 }, ADMIN);
  await db.setPayRate(ORG, { caregiverId: 'pp-b', rateCents: 1000 }, ADMIN); // changed
  await db.setPayRate(ORG, { caregiverId: 'pp-d', rateCents: 1000 }, ADMIN);
  eq('setting a rate twice keeps one row', (await queryOne("SELECT count(*)::int AS n FROM caregiver_pay_rates WHERE caregiver_id = 'pp-b'")).n, 1);
  check('  ...and the change is in the audit log with the old rate', (await db.getAuditLog(ORG)).some((e) => e.action === 'pay_rate_set' && /\$9\.00 -> \$10\.00/.test(e.detail)));
  await throws("another agency's attendant can't be given a rate", () => db.setPayRate(ORG, { caregiverId: 'pp-z', rateCents: 1500 }, ADMIN), 'Attendant not found');
  await throws("  ...nor a rate for another agency's client", () => db.setPayRate(ORG, { caregiverId: 'pp-a', clientId: 'pp-q', rateCents: 1500 }, ADMIN), 'Client not found');
  const zRate = (await db.getPayRates(ORG)).find((r) => r.caregiverId === 'pp-a' && r.clientId === 'pp-x');
  await throws("another agency can't remove this agency's rate", () => db.deletePayRate(OTHER, zRate.id, ADMIN), 'not found');
  eq("the other agency sees none of these rates", (await db.getPayRates(OTHER)).length, 0);

  // Ana, week Mon 9/7 – Sun 9/13: 4 × 9 hrs with Yuri ($12) + 9 hrs with Xena ($14) = 45 hrs.
  for (const [i, d] of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].entries()) await visit(`pp-a${i}`, 'pp-a', 'pp-y', d, '08:00', '17:00');
  await visit('pp-a4', 'pp-a', 'pp-x', '2026-09-11', '08:00', '17:00');
  // Ben, week Mon 9/14 – Sun 9/20 (split by the 15th): 5 × 9 hrs at $10.
  for (const [i, d] of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].entries()) await visit(`pp-b${i}`, 'pp-b', 'pp-y', d, '08:00', '17:00');
  // Cal: no rate.
  await visit('pp-c0', 'pp-c', 'pp-y', '2026-09-03', '09:00', '13:00');
  // Dee: 21 + 21 hrs on Mon 9/14 and Tue 9/15 only (week ends 9/20, in the 2nd period).
  await visit('pp-d0', 'pp-d', 'pp-x', '2026-09-14', '01:00', '22:00');
  await visit('pp-d1', 'pp-d', 'pp-x', '2026-09-15', '01:00', '22:00');
  await visit('pp-z0', 'pp-z', 'pp-q', '2026-09-08', '08:00', '17:00', OTHER);

  const p1 = payPeriodFor('2026-09-01');
  const p2 = payPeriodFor('2026-09-16');
  const r1 = await report(p1);
  const ana = att(r1, 'pp-a');

  console.log('\n== straight time and overtime ==');
  eq('each visit is paid at its rate', ana.lines.map((l) => l.payCents), [10800, 10800, 10800, 10800, 12600]);
  eq('  ...client rate marked', ana.lines[4].rateSource, 'client');
  eq("Ana's straight time: 36 × $12 + 9 × $14 = $558.00", ana.pay.straightCents, 55800);
  const aw = ana.payWeeks.find((w) => w.monday === '2026-09-07');
  eq('  ...regular rate is the weighted average $12.40', aw.regularRateCents, 1240);
  eq('  ...5 hrs over 40 -> premium 5 × ½ × $12.40 = $31.00', [aw.overtimeMinutes, aw.premiumCents], [300, 3100]);
  eq('  ...gross $589.00', ana.pay.grossCents, 58900);

  const ben1 = att(r1, 'pp-b');
  eq('Ben, 1st–15th: only 9/14–9/15 straight time ($180), no premium yet', [ben1.pay.straightCents, ben1.pay.premiumCents, ben1.pay.grossCents], [18000, 0, 18000]);
  eq('  ...the split week is noted as paying overtime later', ben1.pay.deferredWeeks.map((w) => w.monday), ['2026-09-14']);
  const r2 = await report(p2);
  const ben2 = att(r2, 'pp-b');
  eq('Ben, 16th–30th: 27 hrs ($270) + premium 5 × ½ × $10 ($25) = $295', [ben2.pay.straightCents, ben2.pay.premiumCents, ben2.pay.grossCents], [27000, 2500, 29500]);
  eq('  ...overtime hours are counted in the period the week ends', [ben1.pay.overtimeMinutes, ben2.pay.overtimeMinutes], [0, 300]);
  const dee2 = att(r2, 'pp-d');
  check('Dee has no visits after the 15th but is still owed the premium in the 2nd period', Boolean(dee2) && dee2.lines.length === 0);
  eq('  ...2 hrs over 40 at $10 -> $10.00', [dee2?.pay.premiumCents, dee2?.pay.grossCents], [1000, 1000]);

  console.log('\n== missing rates ==');
  const cal = att(r1, 'pp-c');
  eq('a visit with no rate shows no pay', [cal.lines[0].rateCents, cal.lines[0].payCents, cal.pay.grossCents], [null, null, null]);
  eq('  ...and the period has no gross total', r1.summary.pay.grossCents, null);
  eq('  ...but the known pay so far is shown', r1.summary.pay.knownGrossCents, 58900 + 18000 + 21 * 2 * 1000);
  check('  ...and it blocks approval', approvalBlockers(r1, TODAY).some((b) => b.includes('no pay rate')));

  console.log('\n== approving and locking ==');
  check("a period that hasn't ended can't be approved", approvalBlockers(await report(p1, '2026-09-10'), '2026-09-10').some((b) => b.includes('hasn’t ended')));
  check("a custom range can't be approved", approvalBlockers({ ...r1, period: { ...p1, frequency: 'custom' } }, TODAY).some((b) => b.includes('custom')));
  await db.setPayRate(ORG, { caregiverId: 'pp-c', rateCents: 1100 }, ADMIN);
  const ready = await report(p1);
  eq('with every rate in place nothing blocks approval', approvalBlockers(ready, TODAY), []);
  eq('  ...gross for 9/1–9/15', ready.summary.pay.grossCents, 58900 + 18000 + 42000 + 4400);
  const snap = buildSnapshot(ready, '2026-10-05T12:00:00Z');
  const id = await db.approvePayrollPeriod(ORG, { period: p1, snapshot: snap }, ADMIN);
  const approved = await db.getApprovedPayrollPeriod(ORG, p1);
  eq('the period is stored as approved with its snapshot', [approved?.id, approved?.status, approved?.snapshot.summary.grossCents], [id, 'approved', ready.summary.pay.grossCents]);
  check('  ...and it is in the audit log', (await db.getAuditLog(ORG)).some((e) => e.action === 'payroll_period_approved' && e.entityId === id));
  await throws('it cannot be approved twice', () => db.approvePayrollPeriod(ORG, { period: p1, snapshot: snap }, ADMIN), 'already approved');
  await throws('an overlapping weekly period cannot be approved', () => db.approvePayrollPeriod(ORG, { period: payPeriodFor('2026-09-09', 'weekly'), snapshot: snap }, ADMIN), 'overlaps');
  await throws('a custom range is refused by the database layer too', () => db.approvePayrollPeriod(ORG, { period: { from: '2026-10-01', to: '2026-10-02', frequency: 'custom' }, snapshot: snap }, ADMIN), 'regular pay period');
  eq("another agency doesn't see it", await db.getApprovedPayrollPeriod(OTHER, p1), null);
  eq('nothing has changed yet', changesSinceApproval(approved.snapshot, await report(p1)), []);

  console.log('\n== changes after approval are flagged, not applied ==');
  await query(`UPDATE visits SET evv_clock_out_at = $1, evv_clock_out = '6:00 PM' WHERE id = 'pp-a0'`, [ct('2026-09-07', '18:00')]);
  await query(`UPDATE visits SET status = 'missed' WHERE id = 'pp-c0'`);
  await visit('pp-a9', 'pp-a', 'pp-y', '2026-09-12', '09:00', '10:00');
  await db.setPayRate(ORG, { caregiverId: 'pp-b', rateCents: 1050 }, ADMIN);
  const after = await report(p1);
  const ch = changesSinceApproval(approved.snapshot, after);
  eq('a longer clock-out, a visit now missed, a new visit and a new rate are all listed', ch.map((c) => `${c.visitId}:${c.kind}`).sort(), ['pp-a0:changed', 'pp-a9:added', 'pp-b0:changed', 'pp-b1:changed', 'pp-c0:removed'].sort());
  const detailCsv = payrollCsv({ attendants: approved.snapshot.attendants }, { includePay: true });
  check('the approved copy still has the original hours', detailCsv.includes('pp-a0') && detailCsv.includes(',9.00,') && !detailCsv.includes('pp-a9'));

  console.log('\n== reopening ==');
  await throws('reopening needs a reason', () => db.reopenPayrollPeriod(ORG, id, 'no', ADMIN), 'why');
  await throws("another agency can't reopen it", () => db.reopenPayrollPeriod(OTHER, id, 'Corrected a visit', ADMIN), 'isn’t approved');
  await db.reopenPayrollPeriod(ORG, id, 'Corrected a visit', ADMIN);
  eq('after reopening it is no longer approved', await db.getApprovedPayrollPeriod(ORG, p1), null);
  await throws('it cannot be reopened twice', () => db.reopenPayrollPeriod(ORG, id, 'Again please', ADMIN), 'isn’t approved');
  const hist = await db.getPayrollPeriodHistory(ORG);
  eq('the reopened approval stays in the history with its reason', [hist[0].status, hist[0].reopenReason, hist[0].summary.grossCents], ['reopened', 'Corrected a visit', ready.summary.pay.grossCents]);
  const again = buildSnapshot(await report(p1));
  const id2 = await db.approvePayrollPeriod(ORG, { period: p1, snapshot: again }, ADMIN);
  check('it can be approved again after reopening', Boolean(id2) && id2 !== id);

  console.log('\n== the shared loader ==');
  const loaded = await loadPayrollReport(ORG, p1, { today: TODAY });
  eq('loads the approved record and finds no changes', [loaded.approved?.id, loaded.changes.length], [id2, 0]);
  const scoped = await loadPayrollReport(ORG, p1, { today: TODAY, locationId: 'loc-none' });
  check("a location-scoped report can't be approved", scoped.blockers.some((b) => b.includes('agency admin')));

  console.log('\n== CSV ==');
  const sum = payrollSummaryCsv(r2).trim().split('\r\n');
  eq('summary header', sum[0], SUMMARY_COLUMNS.join(','));
  check("summary row for Ben's 2nd period", sum.some((l) => l.startsWith('pp-b,Ben Split-Week,2026-09-16,2026-09-30,3,27.00,270.00,5.00,25.00,295.00')), sum.join(' | '));
  check('summary row for Dee (premium only)', sum.some((l) => l.startsWith('pp-d,Dee Early-Week,2026-09-16,2026-09-30,0,0.00,0.00,2.00,10.00,10.00')));
  const withPay = payrollCsv(r2, { includePay: true }).split('\r\n')[0];
  eq('visit detail with pay has the pay columns', withPay, [...CSV_COLUMNS, ...CSV_PAY_COLUMNS].join(','));
  check('visit detail without pay has none', !payrollCsv(r2).includes('Rate'));
  eq('the approved copy produces the same summary as the report it was built from', payrollSummaryCsv({ period: p1, attendants: again.attendants }), payrollSummaryCsv({ ...(await report(p1)), attendants: (await report(p1)).attendants.filter((a) => a.lines.some((l) => l.state === 'verified') || a.pay.premiumCents) }));

  console.log('\n== access ==');
  eq('only an agency admin can set rates or approve', ['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR', 'CAREGIVER'].map((r) => hasPermission(r, 'admin.payroll.manage')), [true, false, false, false]);
  const key = (p) => ROUTE_PERMISSIONS.find((r) => r.test(p))?.key;
  eq('the rates page is admin-only', [key('/admin/payroll/rates'), hasPermission('LOCATION_ADMIN', 'admin.payroll.rates.view')], ['admin.payroll.rates.view', false]);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`PAYROLL PAY RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
