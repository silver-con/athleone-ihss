import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getVisits, getClients, getCaregivers, getOrganization } from '@/lib/queries';
import StatTile from '@/components/StatTile';
import StatusBar from '@/components/charts/StatusBar';
import ExceptionActionButton from '@/components/admin/ExceptionActionButton';
import { resolveWeekStart, isInWeek, shortDayLabel, todayIso, mondayOf } from '@/lib/calendar';
import WeekNav from '@/components/WeekNav';
import { getComplianceProfile, getReasonCodeInfo } from '@/lib/state-compliance';
import { visitStatusInfo, VISIT_STATUS_ORDER } from '@/lib/styles';

export default async function EvvPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const [allVisits, clients, caregivers, organization] = await Promise.all([
    getVisits(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getCaregivers(session.organizationId, session.locationId),
    getOrganization(session.organizationId),
  ]);
  const profile = getComplianceProfile(organization?.state);

  // One real calendar week at a time (?week=, default this week). Older
  // open exceptions also show on the Compliance Center's maintenance queue.
  const weekStart = resolveWeekStart((await searchParams)?.week);
  const isThisWeek = weekStart === mondayOf(todayIso());
  const visits = allVisits.filter((v) => isInWeek(v.serviceDate, weekStart));

  const closed = visits.filter((v) => v.status === 'completed' || v.status === 'missed');
  const verifiedClosed = closed.filter((v) => v.evv?.verified);
  const missed = visits.filter((v) => v.status === 'missed');
  const openExceptions = visits.filter((v) => v.evv?.exception && !v.resolved);

  const statusSegments = VISIT_STATUS_ORDER.map((key) => {
    const info = visitStatusInfo(key);
    return {
      key,
      label: info.label,
      value: visits.filter((v) => v.status === key).length,
      color: info.dot,
    };
  });

  const logRows = visits
    .filter((v) => v.status !== 'scheduled')
    .slice()
    .sort((a, b) => (a.serviceDate || '').localeCompare(b.serviceDate || '') || String(a.start).localeCompare(String(b.start)));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">EVV Compliance</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">
            Electronic Visit Verification — clock-in/out records and exceptions, one week at a time
          </p>
          <Link
            href="/admin/evv/sync"
            className="inline-block text-[12.5px] font-display font-bold text-[var(--accent)] mt-2"
          >
            State transmission status →
          </Link>
        </div>
        <Link
          href="/admin/compliance"
          className="shrink-0 text-[12.5px] font-display font-bold text-white bg-[var(--accent-strong)] px-3.5 py-2 rounded-[10px]"
        >
          EVV Compliance Center →
        </Link>
      </div>

      <div className="mt-5">
        <WeekNav basePath="/admin/evv" weekStart={weekStart} />
      </div>

      <div className="flex flex-wrap gap-3 mt-4">
        <StatTile num={visits.length} label={isThisWeek ? 'Visits this week' : 'Visits that week'} />
        <StatTile num={`${verifiedClosed.length} / ${closed.length || 0}`} label="Completed visits verified" />
        <StatTile
          num={missed.length}
          label="Missed visits"
          accent={missed.length > 0 ? 'var(--danger)' : undefined}
        />
        <StatTile
          num={openExceptions.length}
          label="Open exceptions"
          accent={openExceptions.length > 0 ? 'var(--danger)' : undefined}
        />
      </div>

      <div className="grid grid-cols-[1.2fr_1.8fr] gap-4 mt-6 items-start">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Visits by status</div>
          <StatusBar segments={statusSegments} />
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">What EVV verifies</div>
          <p className="text-[13px] text-[var(--muted)] leading-relaxed">
            Each visit is expected to be clocked in and out from the client&rsquo;s home, using GPS on the
            caregiver&rsquo;s phone or, when that isn&rsquo;t available, a telephony check-in from the client&rsquo;s
            landline. A visit is <span className="font-display font-bold text-[var(--text)]">verified</span> once
            both timestamps and a location/method match are on file — anything else (a missed clock-in, a
            late start, an early clock-out) is flagged below as an exception for the office to review.
          </p>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-4">
        <div className="grid grid-cols-[1.2fr_1.1fr_0.9fr_0.9fr_0.9fr_1.2fr_0.9fr_1.7fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Caregiver</div>
          <div>Visit</div>
          <div>Clock-in</div>
          <div>Clock-out</div>
          <div>Method</div>
          <div>Status</div>
          <div>Exception</div>
        </div>

        {logRows.map((v) => {
          const client = clients.find((c) => c.id === v.clientId);
          const caregiver = caregivers.find((c) => c.id === v.caregiverId);
          const info = visitStatusInfo(v.status);
          const hasException = v.evv?.exception;

          return (
            <div
              key={v.id}
              className="grid grid-cols-[1.2fr_1.1fr_0.9fr_0.9fr_0.9fr_1.2fr_0.9fr_1.7fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
            >
              <Link href={`/admin/evv/visits/${v.id}`} className="font-display font-bold text-[13.5px] hover:text-[var(--accent)]">
                {client?.name}
              </Link>
              <div>{caregiver?.name}</div>
              <div className="text-[12px] text-[var(--muted)]">
                {shortDayLabel(v.serviceDate)} {v.start}
              </div>
              <div className="flex items-center gap-1">
                {v.evv?.clockIn || '—'}
                {typeof v.evv?.clockInLat === 'number' && (
                  <span title="Location captured on clock-in" className="text-[10px] text-[var(--success)]">●</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {v.evv?.clockOut || '—'}
                {typeof v.evv?.clockOutLat === 'number' && (
                  <span title="Location captured on clock-out" className="text-[10px] text-[var(--success)]">●</span>
                )}
              </div>
              <div className="text-[12px]">{v.evv?.method || '—'}</div>
              <div>
                <span className={'inline-flex items-center gap-1.5 text-[11px] font-display font-bold px-2.5 py-1 rounded-full ' + info.className}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.dot }} />
                  {info.label}
                </span>
              </div>
              <div>
                {!hasException ? (
                  v.status === 'in-progress' ? (
                    <ExceptionActionButton visitId={v.id} variant="review" />
                  ) : (
                    <span className="text-[12px] text-[var(--muted)]">—</span>
                  )
                ) : (
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className="text-[12px] text-[var(--danger)] font-display font-semibold leading-snug">
                      Code {v.evv.exception} — {getReasonCodeInfo(profile, v.evv.exception)?.label || 'Unknown reason code'}
                    </span>
                    {v.resolved ? (
                      <Link href={`/admin/evv/visits/${v.id}`} className="text-[11.5px] font-display font-bold text-[var(--success)]">Verified ✓ · history</Link>
                    ) : (
                      <ExceptionActionButton visitId={v.id} variant="review" />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
