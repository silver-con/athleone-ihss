// Payroll: what each attendant worked in a pay period — laid out like the
// "Service Attendant Visit Log" agencies hand to their payroll company — and,
// for agency admins, what they're owed (rates, overtime premium, gross pay),
// with approving and locking the pay period. Hours math: lib/payroll-hours.js.
// Pay math: lib/payroll-pay.js. Report assembly: lib/payroll-report.js.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getLocation, getPayrollPeriodHistory } from '@/lib/queries';
import {
  resolvePayPeriod, previousPeriod, nextPeriod, periodLabel,
  fmtHours, LINE_STATES, PAY_FREQUENCIES, OVERTIME_THRESHOLD_HOURS, WORKWEEK,
} from '@/lib/payroll-hours';
import { money } from '@/lib/payroll-pay';
import { loadPayrollReport } from '@/lib/payroll-report';
import { shortDayLabel } from '@/lib/calendar';
import StatTile from '@/components/StatTile';
import { ApprovePeriodForm, ReopenPeriodForm } from '@/components/admin/PayrollForms';

const TONE = {
  success: 'text-[oklch(45%_0.12_150)]',
  danger: 'text-[var(--danger)]',
  muted: 'text-[var(--muted)]',
};
const AMBER = 'bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-3.5 mt-4 text-[13px] text-[oklch(38%_0.09_75)]';

function periodQuery(p) {
  return p.frequency === 'custom' ? `from=${p.from}&to=${p.to}` : `freq=${p.frequency}&period=${p.from}`;
}
const fmtDateTime = (d) => new Date(d).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });

export default async function PayrollPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const params = (await searchParams) || {};
  const period = resolvePayPeriod(params);
  const canPay = hasPermission(session.role, 'admin.payroll.manage');

  const [{ report, approved, overlapping, changes, blockers }, location, history] = await Promise.all([
    loadPayrollReport(session.organizationId, period, { locationId: session.locationId }),
    session.locationId ? getLocation(session.organizationId, session.locationId) : null,
    canPay ? getPayrollPeriodHistory(session.organizationId, 6) : [],
  ]);
  const { summary } = report;
  const q = periodQuery(period);
  const freq = period.frequency === 'custom' ? 'semimonthly' : period.frequency;
  const navBase = period.frequency === 'custom' ? { ...period, frequency: 'semimonthly' } : period;
  const payCols = canPay ? 2 : 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">Payroll</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[760px]">
            Verified visit hours for each attendant in the pay period{canPay ? ', their pay, and approving the period for your payroll company' : ' — the visit log your payroll company works from'}.
            Only completed, EVV-verified visits with no open exception count. Tax withholding and deductions are done by
            your payroll provider.
            {location?.name ? ` Showing attendants in ${location.name}.` : ''}
          </p>
        </div>
        {canPay && (
          <Link href="/admin/payroll/rates" className="shrink-0 border border-[var(--border)] bg-white font-display font-bold text-[13px] rounded-xl px-4 py-2.5">
            Pay rates
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Link href={`/admin/payroll?${periodQuery(previousPeriod(navBase))}`} className="text-[13px] font-display font-bold text-[var(--accent)]" aria-label="Previous pay period">←</Link>
        <span className="font-display font-extrabold text-[15px]">{periodLabel(period)}</span>
        <Link href={`/admin/payroll?${periodQuery(nextPeriod(navBase))}`} className="text-[13px] font-display font-bold text-[var(--accent)]" aria-label="Next pay period">→</Link>
        <span className="text-[12px] text-[var(--muted)]">{period.frequency === 'custom' ? 'Custom range' : PAY_FREQUENCIES[period.frequency]}</span>
        {approved && <span className="text-[11.5px] font-display font-bold bg-[var(--success-soft)] text-[var(--success)] rounded-full px-2.5 py-1">Approved · locked</span>}
        <form className="flex flex-wrap items-center gap-2 ml-auto text-[12.5px]" action="/admin/payroll">
          <select name="freq" defaultValue={freq} className="border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--surface)]">
            {Object.entries(PAY_FREQUENCIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input type="hidden" name="period" value={period.from} />
          <button className="font-display font-bold text-[var(--accent)]">Change</button>
        </form>
      </div>
      <form className="flex flex-wrap items-center gap-2 mt-2 text-[12.5px] text-[var(--muted)]" action="/admin/payroll">
        Or a custom range:
        <input type="date" name="from" defaultValue={period.from} className="border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--surface)]" />
        to
        <input type="date" name="to" defaultValue={period.to} className="border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--surface)]" />
        <button className="font-display font-bold text-[var(--accent)]">Show</button>
      </form>

      {approved && (
        <div className="bg-[var(--success-soft)] border border-[oklch(85%_0.06_150)] rounded-2xl px-5 py-3.5 mt-4 text-[13px]">
          <strong className="font-display">Approved and locked</strong> by {approved.approvedByName} on {fmtDateTime(approved.approvedAt)}
          {canPay && approved.snapshot?.summary?.grossCents != null && <> at <strong>{money(approved.snapshot.summary.grossCents)}</strong> gross pay</>}.
          {' '}The payroll files below come from this approved copy.
          {canPay && <div className="mt-2"><ReopenPeriodForm periodId={approved.id} /></div>}
        </div>
      )}
      {changes.length > 0 && (
        <div className={AMBER}>
          <strong className="font-display">{changes.length} visit(s) changed since this period was approved.</strong> The payroll files still
          show the approved numbers. If these changes should be paid, reopen the period and approve it again.
          <ul className="list-disc ml-5 mt-1">
            {changes.map((c) => (
              <li key={c.visitId}>
                {shortDayLabel(c.serviceDate)} · {c.attendant} · visit {c.visitId}: {c.detail}{' '}
                <Link href={`/admin/evv/visits/${c.visitId}`} className="font-bold text-[var(--accent)]">View →</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {overlapping.length > 0 && (
        <div className={AMBER}>
          These dates overlap an approved pay period ({overlapping.map((o) => periodLabel(o)).join(', ')}). Open that period to see what was approved.
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4">
        <StatTile num={summary.attendants} label="Attendants" />
        <StatTile num={fmtHours(summary.verifiedMinutes)} label={`Verified hours (${summary.verifiedVisits} visits)`} />
        <StatTile num={fmtHours(summary.varianceMinutes)} label="Variance vs scheduled" accent={summary.varianceMinutes !== 0 ? 'oklch(50% 0.12 75)' : undefined} />
        <StatTile num={summary.needsAttention} label="Visits to fix before payroll" accent={summary.needsAttention ? 'var(--danger)' : undefined} />
        {canPay && (
          <StatTile
            num={summary.pay.grossCents == null ? `${money(summary.pay.knownGrossCents)}+` : money(summary.pay.grossCents)}
            label={summary.pay.grossCents == null ? 'Gross pay so far (rates missing)' : `Gross pay${summary.pay.premiumCents ? ` incl. ${money(summary.pay.premiumCents)} overtime` : ''}`}
            accent={summary.pay.grossCents == null ? 'var(--danger)' : undefined}
          />
        )}
      </div>

      {summary.needsAttention > 0 && (
        <div className={AMBER}>
          <strong className="font-display">{summary.needsAttention} visit(s) aren&rsquo;t counted yet.</strong> They&rsquo;re listed under each
          attendant below with what to fix. Fix them before payroll, or the attendant is underpaid.
        </div>
      )}
      {canPay && summary.pay.missingRateVisits > 0 && (
        <div className={AMBER}>
          <strong className="font-display">{summary.pay.missingRateVisits} verified visit(s) have no pay rate.</strong>{' '}
          <Link href="/admin/payroll/rates" className="font-bold text-[var(--accent)]">Add pay rates →</Link>
        </div>
      )}

      {canPay && !approved && period.frequency !== 'custom' && (
        <section className="mt-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4">
          <h2 className="font-display font-extrabold text-[15px] mb-2">Approve this pay period</h2>
          <p className="text-[12.5px] text-[var(--muted)] mb-2">
            Approving freezes every visit&rsquo;s hours, rate and pay for this period. Later changes to a visit are flagged here instead of
            silently changing a period that has been paid.
          </p>
          <ApprovePeriodForm
            freq={period.frequency}
            periodFrom={period.from}
            grossCents={summary.pay.grossCents}
            grossLabel={money(summary.pay.grossCents)}
            blockers={overlapping.length ? [...blockers, 'These dates overlap an approved pay period.'] : blockers}
          />
        </section>
      )}

      <section className="mt-5 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-display font-bold">Payroll files:</span>
        <a href={`/admin/payroll/export?${q}`} className="bg-[var(--accent-strong)] text-white font-display font-bold rounded-xl px-4 py-2">
          Visit detail (CSV)
        </a>
        {canPay && (
          <a href={`/admin/payroll/export?${q}&type=summary`} className="border border-[var(--border)] bg-white font-display font-bold rounded-xl px-4 py-2">
            Pay summary per attendant (CSV)
          </a>
        )}
        <span className="text-[12px] text-[var(--muted)]">
          {approved ? 'From the approved copy.' : canPay ? 'Not approved yet — numbers can still change.' : 'Hours only.'}
        </span>
      </section>

      {report.attendants.length === 0 && <p className="mt-8 text-[13.5px] text-[var(--muted)]">No visits in this pay period.</p>}

      {report.attendants.map((a) => (
        <section key={a.caregiverId} className="mt-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5 border-b border-[var(--border)]">
            <div>
              <h2 className="font-display font-extrabold text-[16px]">{a.name}</h2>
              <p className="text-[12px] text-[var(--muted)]">{a.role}{a.role ? ' · ' : ''}Attendant ID {a.caregiverId}</p>
            </div>
            <div className="text-[12.5px] text-right">
              <span className="font-display font-extrabold text-[15px]">{fmtHours(a.totals.verifiedMinutes)}</span> verified hrs
              <span className="text-[var(--muted)]"> · {fmtHours(a.totals.scheduledMinutes)} scheduled · variance {fmtHours(a.totals.varianceMinutes)}</span>
              {canPay && (
                <div className="font-display font-extrabold text-[15px] mt-0.5">
                  {a.pay.grossCents == null ? <span className="text-[var(--danger)]">Pay can&rsquo;t be worked out yet</span> : <>{money(a.pay.grossCents)} gross</>}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11.5px] text-[var(--muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-5 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Visit ID</th>
                  <th className="px-2 py-2 font-semibold">Client</th>
                  <th className="px-2 py-2 font-semibold">Bill code</th>
                  <th className="px-2 py-2 font-semibold">Scheduled</th>
                  <th className="px-2 py-2 font-semibold">Clocked</th>
                  <th className="px-2 py-2 font-semibold text-right">Sched hrs</th>
                  <th className="px-2 py-2 font-semibold text-right">Verified hrs</th>
                  <th className="px-2 py-2 font-semibold text-right">Bill hrs</th>
                  {canPay && <th className="px-2 py-2 font-semibold text-right">Rate</th>}
                  {canPay && <th className="px-2 py-2 font-semibold text-right">Pay</th>}
                  <th className="px-5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {a.lines.map((l) => {
                  const st = LINE_STATES[l.state];
                  return (
                    <tr key={l.visitId} className="border-b border-[var(--border)] last:border-0 align-top">
                      <td className="px-5 py-2 whitespace-nowrap">{shortDayLabel(l.serviceDate)}</td>
                      <td className="px-2 py-2 font-mono text-[11.5px]">{l.visitId}</td>
                      <td className="px-2 py-2">{l.clientName}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{l.serviceCode || '—'}{l.modifiers ? ` ${l.modifiers}` : ''}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{l.start} – {l.end}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{l.clockIn || '—'}{l.clockOut ? ` – ${l.clockOut}` : ''}</td>
                      <td className="px-2 py-2 text-right">{l.scheduledMinutes == null ? '—' : fmtHours(l.scheduledMinutes)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{l.verifiedMinutes == null ? '—' : fmtHours(l.verifiedMinutes)}</td>
                      <td className="px-2 py-2 text-right">
                        {l.billMinutes == null ? '—' : fmtHours(l.billMinutes)}
                        {l.adjusted && <span className="text-[var(--muted)]" title="Lowered in visit maintenance (110 B)"> *</span>}
                      </td>
                      {canPay && (
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {l.state !== 'verified' ? '' : l.rateCents == null ? <span className="text-[var(--danger)] font-bold">No rate</span> : <>{money(l.rateCents)}{l.rateSource === 'client' && <span className="text-[var(--muted)]" title="Rate for this client"> ◆</span>}</>}
                        </td>
                      )}
                      {canPay && <td className="px-2 py-2 text-right">{l.payCents == null ? '' : money(l.payCents)}</td>}
                      <td className="px-5 py-2">
                        <span className={`font-display font-bold ${TONE[st.tone]}`}>{st.label}</span>
                        {st.fix && (
                          <div className="text-[11.5px] text-[var(--muted)]">
                            {st.fix}{' '}
                            <Link href={`/admin/evv/visits/${l.visitId}`} className="text-[var(--accent)] font-bold">Fix →</Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[oklch(97%_0.005_250)] font-display font-bold">
                  <td className="px-5 py-2" colSpan={6}>Total for {a.name} ({a.totals.visits} verified visit{a.totals.visits === 1 ? '' : 's'})</td>
                  <td className="px-2 py-2 text-right">{fmtHours(a.totals.scheduledMinutes)}</td>
                  <td className="px-2 py-2 text-right">{fmtHours(a.totals.verifiedMinutes)}</td>
                  <td className="px-2 py-2 text-right">{fmtHours(a.totals.billMinutes)}</td>
                  {canPay && <td className="px-2 py-2" />}
                  {canPay && <td className="px-2 py-2 text-right">{money(a.pay.straightCents)}</td>}
                  <td className="px-5 py-2">Variance {fmtHours(a.totals.varianceMinutes)}</td>
                </tr>
                {canPay && (
                  <tr className="font-display text-[12.5px]">
                    <td className="px-5 py-2" colSpan={9 + payCols - 1}>
                      Straight time {money(a.pay.straightCents)}
                      {' + '}overtime premium {a.pay.unknownPremium ? <span className="text-[var(--danger)]">unknown (a visit that week has no rate)</span> : money(a.pay.premiumCents)}
                      {a.pay.overtimeMinutes ? ` (${fmtHours(a.pay.overtimeMinutes)} hrs × ½ regular rate)` : ''}
                    </td>
                    <td className="px-2 py-2 text-right font-extrabold">{money(a.pay.grossCents)}</td>
                    <td className="px-5 py-2 font-extrabold">Gross pay</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {(canPay ? a.payWeeks : a.weeks).length > 0 && (
            <div className="px-5 py-3 border-t border-[var(--border)] text-[12px] text-[var(--muted)] flex flex-wrap gap-x-5 gap-y-1">
              <span className="font-display font-bold">Workweeks ({WORKWEEK}):</span>
              {(canPay ? a.payWeeks : a.weeks).map((w) => (
                <span key={w.monday} className={w.overtimeMinutes ? 'text-[var(--danger)] font-bold' : ''}>
                  {shortDayLabel(w.monday)}–{shortDayLabel(w.sunday)}: {fmtHours(w.minutes)} hrs
                  {w.overtimeMinutes ? ` (${fmtHours(w.overtimeMinutes)} over ${OVERTIME_THRESHOLD_HOURS}` : ''}
                  {w.overtimeMinutes && canPay ? (w.paidThisPeriod ? `, premium ${money(w.premiumCents)} paid this period` : ', premium paid in the period this week ends') : ''}
                  {w.overtimeMinutes ? ')' : ''}
                </span>
              ))}
            </div>
          )}
        </section>
      ))}

      {canPay && history.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-extrabold text-[15px]">Recent approvals</h2>
          <ul className="mt-2 text-[12.5px] space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/admin/payroll?freq=${h.frequency}&period=${h.from}`} className="font-bold text-[var(--accent)]">{periodLabel(h)}</Link>
                {' — '}{h.status === 'approved' ? 'approved' : 'reopened'} by {h.status === 'approved' ? h.approvedByName : h.reopenedByName}
                {' on '}{fmtDateTime(h.status === 'approved' ? h.approvedAt : h.reopenedAt)}
                {h.summary?.grossCents != null ? ` · ${money(h.summary.grossCents)} gross` : ''}
                {h.status === 'reopened' && h.reopenReason ? ` · “${h.reopenReason}”` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-[12px] text-[var(--muted)] max-w-[760px]">
        Verified hours are clock-in to clock-out. Bill hours are what the visit bills for (the scheduled time, or less after a
        110 B adjustment, marked *).{canPay ? ' Pay = verified hours × the attendant’s rate (a client rate, marked ◆, if set). Overtime: hours past 40 in a workweek earn an extra half of the week’s regular rate (its straight-time pay ÷ its hours), paid in the pay period in which the week ends.' : ''}
        {' '}Workweek totals count the whole {WORKWEEK} week, including days outside this pay period.
      </p>
    </div>
  );
}
