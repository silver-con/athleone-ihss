import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getVisitExportRows,
  getClients,
  getCaregivers,
  getAllServiceAuthorizations,
  getEvvCredentials,
  getOrganization,
  getMaintenanceWindowDays,
  getOverlapConflicts,
  describeOverlapConflicts,
} from '@/lib/queries';
import { buildVisitPayload, validateVisitPayload } from '@/lib/evv-mapping';
import { exportState, isLocalRefusal, EXPORT_STATES, EXPORT_STATE_ORDER } from '@/lib/evv-export';
import { resolveWeekStart, addDays, todayIso, shortDayLabel } from '@/lib/calendar';
import StatTile from '@/components/StatTile';
import WeekNav from '@/components/WeekNav';
import EvvExportTable from '@/components/admin/EvvExportTable';

// Problems that are about the agency's EVV setup rather than one visit —
// shown once in a banner instead of on every row.
const AGENCY_PROBLEM = /provider tax ID|office identifier|office NPI/i;

// The authorization a visit exports under: the one picked at scheduling,
// else the client's approved authorization in force today (mirrors
// lib/queries.js loadVisitExportContext, in memory for the whole page).
function authorizationFor(visit, auths) {
  if (visit.serviceAuthorizationId) {
    const picked = auths.find((a) => a.id === visit.serviceAuthorizationId);
    if (picked) return picked;
  }
  const today = todayIso();
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  return (
    auths.find(
      (a) =>
        a.clientId === visit.clientId &&
        a.status === 'approved' &&
        (!iso(a.startDate) || iso(a.startDate) <= today) &&
        (!iso(a.endDate) || iso(a.endDate) >= today)
    ) || null
  );
}

export default async function EvvExportPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const params = (await searchParams) || {};

  const organization = await getOrganization(session.organizationId);
  const windowDays = getMaintenanceWindowDays(organization);
  const showWindow = params.range === 'window';
  const weekStart = resolveWeekStart(params.week);
  const from = showWindow ? addDays(todayIso(), -windowDays) : weekStart;
  const to = showWindow ? todayIso() : addDays(weekStart, 6);

  const [rows, clients, caregivers, auths, credentials] = await Promise.all([
    getVisitExportRows(session.organizationId, { from, to }, session.locationId),
    getClients(session.organizationId, session.locationId),
    getCaregivers(session.organizationId, session.locationId),
    getAllServiceAuthorizations(session.organizationId, session.locationId),
    getEvvCredentials(session.organizationId),
  ]);

  const recheck = (r) => !r.latestSync || r.latestSync.status === 'pending' || isLocalRefusal(r.latestSync);
  const toCheck = rows.filter(recheck).map((r) => r.visit.id);
  const conflicts = await getOverlapConflicts(session.organizationId, toCheck);

  const agencyProblems = new Set();
  const computed = rows.map((r) => {
    let problems = [];
    const needsCheck = recheck(r);
    if (needsCheck) {
      const payload = buildVisitPayload({
        credentials: credentials || {},
        visit: r.visit,
        client: clients.find((c) => c.id === r.visit.clientId),
        caregiver: caregivers.find((c) => c.id === r.visit.caregiverId),
        authorization: authorizationFor(r.visit, auths),
        state: organization?.state,
      });
      const all = validateVisitPayload(payload);
      all.filter((p) => AGENCY_PROBLEM.test(p)).forEach((p) => agencyProblems.add(p));
      problems = [...all.filter((p) => !AGENCY_PROBLEM.test(p)), ...describeOverlapConflicts(conflicts[r.visit.id])];
    }
    const state = exportState({ visit: r.visit, latestSync: r.latestSync, problems });
    const meta = EXPORT_STATES[state.key];
    return {
      id: r.visit.id,
      dateLabel: `${shortDayLabel(r.visit.serviceDate)} ${r.visit.start}`,
      clientName: r.clientName,
      caregiverName: r.caregiverName,
      stateKey: state.key,
      stateLabel: meta.label,
      tone: meta.tone,
      detail: state.detail,
      fixHref: `/admin/evv/visits/${r.visit.id}`,
    };
  });

  const stateFilter = EXPORT_STATES[params.state] ? params.state : 'all';
  const shown = stateFilter === 'all' ? computed : computed.filter((r) => r.stateKey === stateFilter);
  const count = (k) => computed.filter((r) => r.stateKey === k).length;
  const attention = computed.filter((r) => ['needs_maintenance', 'blocked', 'rejected'].includes(r.stateKey)).length;
  const rangeQuery = showWindow ? 'range=window' : `week=${weekStart}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">EVV Export</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[760px]">
            Every finished visit and where it stands on the way to the state EVV aggregator. A visit isn&rsquo;t
            compliant until the state has accepted it — &ldquo;sent&rdquo; isn&rsquo;t the same as accepted.
          </p>
        </div>
        {session.role === 'ADMIN' && (
          <Link href="/admin/evv/sync" className="shrink-0 text-[12.5px] font-display font-bold text-[var(--accent)] whitespace-nowrap">
            Transmission log &amp; send now →
          </Link>
        )}
      </div>

      {(!credentials || agencyProblems.size > 0) && (
        <div className="bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-4 mt-5 text-[13px] text-[oklch(38%_0.09_75)]">
          <div className="font-display font-extrabold text-[13.5px]">
            {credentials ? 'Agency EVV setup needs fixing before anything can be sent' : 'Not connected to the state aggregator yet'}
          </div>
          {credentials ? (
            <ul className="list-disc ml-5 mt-1">
              {[...agencyProblems].map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : (
            <p className="mt-1">Visits below are checked for missing data now, but nothing is sent until an admin adds the agency&rsquo;s EVV credentials.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-5">
        {showWindow ? (
          <span className="font-display font-extrabold text-[14px]">Last {windowDays} days</span>
        ) : (
          <WeekNav basePath="/admin/evv/export" weekStart={weekStart} query={stateFilter === 'all' ? '' : `state=${stateFilter}`} />
        )}
        <Link
          href={showWindow ? '/admin/evv/export' : '/admin/evv/export?range=window'}
          className="text-[12.5px] font-display font-bold text-[var(--accent)]"
        >
          {showWindow ? 'Back to one week' : `Show the whole ${windowDays}-day window`}
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 mt-4">
        <StatTile num={computed.length} label="Finished visits" />
        <StatTile num={count('accepted')} label="Accepted by the state" />
        <StatTile num={attention} label="Need attention" accent={attention > 0 ? 'var(--danger)' : undefined} />
        <StatTile num={count('on_hold')} label="On hold" />
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {['all', ...EXPORT_STATE_ORDER].map((k) => {
          const n = k === 'all' ? computed.length : count(k);
          if (k !== 'all' && n === 0) return null;
          return (
            <Link
              key={k}
              href={`/admin/evv/export?${rangeQuery}${k === 'all' ? '' : `&state=${k}`}`}
              className={
                'text-[12px] font-display font-bold px-3 py-1.5 rounded-full border ' +
                (stateFilter === k
                  ? 'bg-[var(--accent-strong)] text-white border-[var(--accent-strong)]'
                  : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)]')
              }
            >
              {k === 'all' ? 'All' : EXPORT_STATES[k].label} ({n})
            </Link>
          );
        })}
      </div>

      <EvvExportTable rows={shown} canQueueStates={['not_queued', 'rejected']} />
    </div>
  );
}
