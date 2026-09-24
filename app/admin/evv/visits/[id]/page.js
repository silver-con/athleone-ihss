import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getVisit,
  getClient,
  getCaregiver,
  getOrganization,
  getVisitMaintenanceHistory,
  getMaintenanceStatus,
  billableMinutes,
} from '@/lib/queries';
import { getComplianceProfile, getReasonCodeInfo, selectableReasonCodes } from '@/lib/state-compliance';
import { visitStatusInfo } from '@/lib/styles';
import VisitMaintenanceForm from '@/components/admin/VisitMaintenanceForm';
import VisitVmurForm from '@/components/admin/VisitVmurForm';
import HomeFromVisitButton from '@/components/admin/HomeFromVisitButton';
import { visitLocationLabel, formatDistance, mapLink } from '@/lib/geo';

const CONTACT_LABEL = {
  none: 'No contact needed',
  client: 'Client',
  caregiver: 'Caregiver',
  substitute: 'Substitute caregiver',
};

function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function codeText(code) {
  return code && code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-[oklch(95%_0.01_85)] last:border-none">
      <span className="text-[12px] text-[var(--muted)] shrink-0">{label}</span>
      <span className="text-[13px] text-right">{children}</span>
    </div>
  );
}

export default async function VisitMaintenancePage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;

  const visit = await getVisit(session.organizationId, id, session.locationId);
  if (!visit) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Visit not found.{' '}
        <Link href="/admin/evv" className="text-[var(--accent)] font-display font-bold">Back to EVV</Link>
      </div>
    );
  }

  const [client, caregiver, organization, history] = await Promise.all([
    getClient(session.organizationId, visit.clientId),
    getCaregiver(session.organizationId, visit.caregiverId),
    getOrganization(session.organizationId),
    getVisitMaintenanceHistory(session.organizationId, visit.id),
  ]);
  const profile = getComplianceProfile(organization?.state);
  const maintenance = getMaintenanceStatus(organization, visit);
  const statusInfo = visitStatusInfo(visit.status);
  const exceptionInfo = getReasonCodeInfo(profile, visit.evv?.exception);
  const hasIn = Boolean(visit.evv?.clockInAt || visit.evv?.clockIn);
  const hasOut = Boolean(visit.evv?.clockOutAt || visit.evv?.clockOut);
  const reasonGroups = selectableReasonCodes(profile);
  const initialCodes =
    visit.evv?.exception && profile?.reasonCodes?.[visit.evv.exception]?.selectable !== false
      ? [visit.evv.exception]
      : [];
  const radius = organization?.homeRadiusFeet ?? 250;
  const hasHome = client?.homeLat !== null && client?.homeLat !== undefined;
  const hasSomethingToFix = (visit.evv?.exception && !visit.resolved) || (visit.status === 'in-progress' && !hasOut);

  return (
    <div>
      <Link href="/admin/evv" className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to EVV
      </Link>

      <h1 className="font-display font-extrabold text-[24px]">Visit maintenance</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        {client?.name || 'Client'} · {caregiver?.name || 'Caregiver'} · {formatDate(visit.serviceDate)}
      </p>

      {maintenance.daysRemaining !== null && (
        <div
          className={
            'mt-4 rounded-xl px-4 py-3 text-[13px] font-display font-bold border ' +
            (maintenance.locked
              ? 'bg-[oklch(96%_0.03_25)] border-[oklch(85%_0.08_25)] text-[var(--danger)]'
              : maintenance.daysRemaining <= 14
                ? 'bg-[oklch(97%_0.03_85)] border-[oklch(85%_0.07_75)] text-[oklch(45%_0.1_75)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)]')
          }
        >
          {maintenance.locked
            ? `Locked: this visit is ${maintenance.daysSinceService} days old, past the ${maintenance.windowDays}-day maintenance window. Only the payer can unlock it (VMUR).`
            : `${maintenance.daysRemaining} day${maintenance.daysRemaining === 1 ? '' : 's'} left of the ${maintenance.windowDays}-day maintenance window.`}
        </div>
      )}

      <div className="grid grid-cols-[1.7fr_1fr] gap-4 mt-5 items-start">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          {maintenance.locked ? (
            <>
              <div className="font-display font-extrabold text-[15px] mb-1">Visit Maintenance Unlock Request</div>
              <p className="text-[12.5px] text-[var(--muted)] mb-4">
                Send the unlock request through the payer&rsquo;s own process, then record it here so the agency has
                a record of when and why.
              </p>
              {visit.vmurSubmitted && (
                <p className="text-[12.5px] font-display font-bold text-[var(--success)] mb-3">A VMUR has already been recorded for this visit — see history.</p>
              )}
              <VisitVmurForm visitId={visit.id} />
            </>
          ) : hasSomethingToFix ? (
            <>
              <div className="font-display font-extrabold text-[15px] mb-4">Correct and verify this visit</div>
              <VisitMaintenanceForm
                visitId={visit.id}
                reasonGroups={reasonGroups}
                initialCodes={initialCodes}
                needsClockIn={!hasIn}
                needsClockOut={!hasOut}
                isMissed={visit.status === 'missed'}
                currentBillMinutes={billableMinutes(visit)}
              />
            </>
          ) : (
            <>
              <div className="font-display font-extrabold text-[15px] mb-1">Nothing to correct</div>
              <p className="text-[13px] text-[var(--muted)]">
                This visit has no open exception. Every correction made to it is listed under History.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <div className="font-display font-extrabold text-[14px] mb-2">Visit record</div>
            <Row label="Client">{client?.name || '—'}</Row>
            <Row label="Medicaid ID">
              {client?.medicaidId || (
                <Link href={`/admin/clients/${visit.clientId}/care-plan#evv-identity`} className="font-display font-bold text-[var(--danger)]">
                  Missing — add it
                </Link>
              )}
            </Row>
            <Row label="Caregiver">{caregiver?.name || '—'}</Row>
            <Row label="Date of service">{formatDate(visit.serviceDate)}</Row>
            <Row label="Scheduled">{visit.start} – {visit.end}</Row>
            <Row label="Billable time">
              {(() => {
                const m = billableMinutes(visit);
                if (!m) return '—';
                return `${Math.floor(m / 60)}h ${m % 60}m${visit.billMinutes ? ' (lowered, 110 B)' : ''}`;
              })()}
            </Row>
            <Row label="Clock-in">
              <ClockEvent visitId={visit.id} which="in" evv={visit.evv} radius={radius} hasHome={hasHome} />
            </Row>
            <Row label="Clock-out">
              <ClockEvent visitId={visit.id} which="out" evv={visit.evv} radius={radius} hasHome={hasHome} />
            </Row>
            <Row label="Method">{visit.evv?.method || '—'}</Row>
            <Row label="Status">
              <span className={'inline-flex items-center gap-1.5 text-[11px] font-display font-bold px-2.5 py-0.5 rounded-full ' + statusInfo.className}>
                {statusInfo.label}
              </span>
            </Row>
            <Row label="Exception">
              {visit.evv?.exception ? (
                <span className={visit.resolved ? '' : 'text-[var(--danger)] font-display font-bold'}>
                  {codeText(visit.evv.exception)} — {exceptionInfo?.label || 'Unknown reason code'}
                  {visit.resolved ? ' (verified)' : ''}
                </span>
              ) : (
                'None'
              )}
            </Row>
            {visit.evv?.note && <Row label="Note">{visit.evv.note}</Row>}
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <div className="font-display font-extrabold text-[14px] mb-2">History</div>
            {history.length === 0 ? (
              <p className="text-[12.5px] text-[var(--muted)]">No corrections yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((h) => (
                  <li key={h.id} className="text-[12.5px] border-l-2 border-[var(--border)] pl-3">
                    <div className="font-display font-bold">
                      {h.kind === 'vmur' ? 'VMUR recorded' : `Verified — ${h.reasonCodes.map(codeText).join(', ')}`}
                    </div>
                    <div className="text-[var(--muted)]">
                      {h.performedByName} · {formatWhen(h.createdAt)}
                    </div>
                    {h.kind === 'maintenance' && (
                      <div className="text-[var(--muted)]">Contacted: {CONTACT_LABEL[h.contact] || h.contact}</div>
                    )}
                    {(h.manualClockInAt || h.manualClockOutAt) && (
                      <div className="text-[var(--muted)]">
                        Entered missing time:{' '}
                        {[h.manualClockInAt && `in ${formatWhen(h.manualClockInAt)}`, h.manualClockOutAt && `out ${formatWhen(h.manualClockOutAt)}`]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    )}
                    {h.billMinutesAfter && (
                      <div className="text-[var(--muted)]">
                        Billable time lowered: {Math.floor(h.billMinutesBefore / 60)}h {h.billMinutesBefore % 60}m → {Math.floor(h.billMinutesAfter / 60)}h {h.billMinutesAfter % 60}m
                      </div>
                    )}
                    {h.payerReference && <div className="text-[var(--muted)]">Payer ref: {h.payerReference}</div>}
                    {h.note && <div className="mt-0.5">&ldquo;{h.note}&rdquo;</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// One clock event on the visit record: time, where the caregiver said they
// were, distance from the client's home (red if they said "client's home"
// but GPS was beyond the radius), a map link, and — when there's a GPS
// fix — a way to adopt it as the client's home location.
function ClockEvent({ visitId, which, evv, radius, hasHome }) {
  const time = which === 'in' ? evv?.clockIn : evv?.clockOut;
  const lat = which === 'in' ? evv?.clockInLat : evv?.clockOutLat;
  const lng = which === 'in' ? evv?.clockInLng : evv?.clockOutLng;
  const where = which === 'in' ? evv?.clockInLocation : evv?.clockOutLocation;
  const distance = which === 'in' ? evv?.clockInDistanceFt : evv?.clockOutDistanceFt;
  const place = visitLocationLabel(where);
  const dist = formatDistance(distance);
  const far = where === 'member_home' && typeof distance === 'number' && distance > radius;
  const href = mapLink(lat, lng);
  if (!time) return <span>Not recorded</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>
        {time}
        {typeof lat === 'number' && <span title="GPS captured" className="ml-1 text-[10px] text-[var(--success)]">●</span>}
      </span>
      {(place || dist || href) && (
        <span className={'text-[11.5px] ' + (far ? 'text-[var(--danger)] font-display font-bold' : 'text-[var(--muted)]')}>
          {[place, dist ? `${dist} from home` : hasHome || !href ? null : 'home location not set'].filter(Boolean).join(' · ')}
          {href && (
            <>
              {' · '}
              <a href={href} target="_blank" rel="noopener noreferrer" className="underline">map</a>
            </>
          )}
        </span>
      )}
      {href && <HomeFromVisitButton visitId={visitId} which={which} />}
    </span>
  );
}
