// Payroll hours: what each attendant worked in a pay period, laid out like
// the "Service Attendant Visit Log" agencies hand to their payroll company
// (verified visits, scheduled vs verified hours, totals and variance), plus
// what still needs fixing before payroll and a 40-hour workweek check.
// Read-only. The math lives in lib/payroll-hours.js.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getPayrollVisits, getLocation } from '@/lib/queries';
import {
  resolvePayPeriod, previousPeriod, nextPeriod, periodLabel, buildPayrollReport,
  fmtHours, LINE_STATES, PAY_FREQUENCIES, OVERTIME_THRESHOLD_HOURS, WORKWEEK,
} from '@/lib/payroll-hours';
import { addDays, mondayOf, shortDayLabel } from '@/lib/calendar';
import StatTile from '@/components/StatTile';

const TONE = {
  success: 'text-[oklch(45%_0.12_150)]',
  danger: 'text-[var(--danger)]',
  muted: 'text-[var(--muted)]',
};

function periodQuery(p) {
  return p.frequency === 'custom' ? `from=${p.from}&to=${p.to}` : `freq=${p.frequency}&period=${p.from}`;
}

export default async function PayrollHoursPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const params = (await searchParams) || {};
  const period = resolvePayPeriod(params);

  const [{ rows, auths }, location] = await Promise.all([
    getPayrollVisits(session.organizationId, { from: mondayOf(period.from), to: addDays(mondayOf(period.to), 6) }, session.locationId),
    session.locationId ? getLocation(session.organizationId, session.locationId) : null,
  ]);
  const report = buildPayrollReport({ rows, auths, period });
  const { summary } = report;
  const q = periodQuery(period);
  const freq = period.frequency === 'custom' ? 'semimonthly' : period.frequency;
  const navBase = period.frequency === 'custom' ? { ...period, frequency: 'semimonthly' } : period;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">Payroll Hours</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[760px]">
            Verified visit hours for each attendant in the pay period — the visit log your payroll company works from.
            Only completed, EVV-verified visits with no open exception count. Pay rates, overtime pay and deductions stay
            in your payroll system.
            {location?.name ? ` Showing attendants in ${location.name}.` : ''}
          </p>
        </div>
        <a
          href={`/admin/payroll/export?${q}`}
          className="shrink-0 bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] rounded-xl px-4 py-2.5"
        >
          Download CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Link href={`/admin/payroll?${periodQuery(previousPeriod(navBase))}`} className="text-[13px] font-display font-bold text-[var(--accent)]" aria-label="Previous pay period">
          ←
        </Link>
        <span className="font-display font-extrabold text-[15px]">{periodLabel(period)}</span>
        <Link href={`/admin/payroll?${periodQuery(nextPeriod(navBase))}`} className="text-[13px] font-display font-bold text-[var(--accent)]" aria-label="Next pay period">
          →
        </Link>
        <span className="text-[12px] text-[var(--muted)]">
          {period.frequency === 'custom' ? 'Custom range' : PAY_FREQUENCIES[period.frequency]}
        </span>
        <form className="flex flex-wrap items-center gap-2 ml-auto text-[12.5px]" action="/admin/payroll">
          <select name="freq" defaultValue={freq} className="border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--surface)]">
            {Object.entries(PAY_FREQUENCIES).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
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

      <div className="flex flex-wrap gap-3 mt-4">
        <StatTile num={summary.attendants} label="Attendants with visits" />
        <StatTile num={fmtHours(summary.verifiedMinutes)} label={`Verified hours (${summary.verifiedVisits} visits)`} />
        <StatTile num={fmtHours(summary.varianceMinutes)} label="Variance vs scheduled" accent={summary.varianceMinutes !== 0 ? 'oklch(50% 0.12 75)' : undefined} />
        <StatTile num={summary.needsAttention} label="Visits to fix before payroll" accent={summary.needsAttention ? 'var(--danger)' : undefined} />
        <StatTile num={summary.overtimeAttendants} label={`Over ${OVERTIME_THRESHOLD_HOURS} hrs in a week`} accent={summary.overtimeAttendants ? 'var(--danger)' : undefined} />
      </div>

      {summary.needsAttention > 0 && (
        <div className="bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-3.5 mt-4 text-[13px] text-[oklch(38%_0.09_75)]">
          <strong className="font-display">{summary.needsAttention} visit(s) aren&rsquo;t counted yet.</strong> They&rsquo;re listed under each
          attendant below with what to fix. Fix them before sending hours to payroll, or the attendant is underpaid.
        </div>
      )}

      {report.attendants.length === 0 && (
        <p className="mt-8 text-[13.5px] text-[var(--muted)]">No visits in this pay period.</p>
      )}

      {report.attendants.map((a) => (
        <section key={a.caregiverId} className="mt-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5 border-b border-[var(--border)]">
            <div>
              <h2 className="font-display font-extrabold text-[16px]">{a.name}</h2>
              <p className="text-[12px] text-[var(--muted)]">
                {a.role}{a.role ? ' · ' : ''}Attendant ID {a.caregiverId}
              </p>
            </div>
            <div className="text-[12.5px] text-right">
              <span className="font-display font-extrabold text-[15px]">{fmtHours(a.totals.verifiedMinutes)}</span> verified hrs
              <span className="text-[var(--muted)]"> · {fmtHours(a.totals.scheduledMinutes)} scheduled · variance {fmtHours(a.totals.varianceMinutes)}</span>
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
                  <td className="px-5 py-2">Variance {fmtHours(a.totals.varianceMinutes)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {a.weeks.length > 0 && (
            <div className="px-5 py-3 border-t border-[var(--border)] text-[12px] text-[var(--muted)] flex flex-wrap gap-x-5 gap-y-1">
              <span className="font-display font-bold">Workweeks ({WORKWEEK}):</span>
              {a.weeks.map((w) => (
                <span key={w.monday} className={w.overtimeMinutes ? 'text-[var(--danger)] font-bold' : ''}>
                  {shortDayLabel(w.monday)}–{shortDayLabel(w.sunday)}: {fmtHours(w.minutes)} hrs
                  {w.overtimeMinutes ? ` (${fmtHours(w.overtimeMinutes)} over ${OVERTIME_THRESHOLD_HOURS})` : ''}
                  {w.partial ? ' · whole week' : ''}
                </span>
              ))}
            </div>
          )}
        </section>
      ))}

      <p className="mt-6 text-[12px] text-[var(--muted)] max-w-[760px]">
        Verified hours are clock-in to clock-out. Bill hours are what the visit bills for (the scheduled time, or less after a
        110 B adjustment, marked *). Workweek totals count the whole {WORKWEEK} week, including days outside this pay period,
        so overtime is never missed when a pay period splits a week.
      </p>
    </div>
  );
}
