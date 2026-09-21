import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getVisits, getClients, getCaregivers, getOrganization } from '@/lib/queries';
import BarChart from '@/components/charts/BarChart';
import ExceptionActionButton from '@/components/admin/ExceptionActionButton';
import { CURES_ACT_ELEMENTS, TODAY_ISO } from '@/lib/data';
import { getComplianceProfile } from '@/lib/state-compliance';
import { maintenanceUrgency } from '@/lib/styles';

function daysRemaining(serviceDate, windowDays) {
  const service = new Date(serviceDate + 'T00:00:00');
  const today = new Date(TODAY_ISO + 'T00:00:00');
  const elapsed = Math.round((today - service) / 86400000);
  return windowDays - elapsed;
}

function formatServiceDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export default async function CompliancePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [visits, clients, caregivers, organization] = await Promise.all([
    getVisits(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getCaregivers(session.organizationId, session.locationId),
    getOrganization(session.organizationId),
  ]);

  const profile = getComplianceProfile(organization?.state);

  // No profile configured for this tenant's state yet — an honest "not
  // built yet" notice, not a silent fallback to Texas's numbers (see
  // lib/state-compliance.js's comment on getComplianceProfile). Today
  // this only fires for a state other than TX, since that's the only
  // profile that exists.
  if (!profile) {
    return (
      <div>
        <h1 className="font-display font-extrabold text-[24px]">EVV Compliance Center</h1>
        <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[720px]">
          {organization?.name || 'Your agency'} is registered in{' '}
          {organization?.state || 'a state Hearth doesn&rsquo;t recognize'}, and Hearth doesn&rsquo;t yet
          have that state&rsquo;s EVV compliance figures (usage threshold, enforcement ladder, reason
          codes) configured here — Texas is the only state built out so far. Reach out to your Hearth
          contact to get {organization?.state || 'your state'} added.
        </p>
      </div>
    );
  }

  const currentQuarter = profile.usageHistory[profile.usageHistory.length - 1];
  const nonCompliantStreak = (() => {
    let streak = 0;
    for (let i = profile.usageHistory.length - 1; i >= 0; i--) {
      if (profile.usageHistory[i].score < profile.usageThreshold) streak++;
      else break;
    }
    return streak;
  })();

  const maintenanceQueue = visits
    .filter((v) => v.evv?.exception && !v.resolved)
    .map((v) => ({ ...v, remaining: daysRemaining(v.serviceDate, profile.visitMaintenanceWindowDays) }))
    .sort((a, b) => a.remaining - b.remaining);

  const closedOutQueue = visits.filter(
    (v) => v.evv?.exception && (v.resolved || v.vmurSubmitted)
  );

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">{profile.stateName} EVV Compliance Center</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[720px]">
        Modeled on {profile.stateName}&rsquo;s published EVV policy handbook ({profile.defaultAggregator} as
        the state EVV aggregator). Figures below reflect currently published policy — the state revises
        this handbook periodically, so treat exact numbers as &ldquo;as published,&rdquo; not
        guaranteed-current law.
      </p>

      {/* EVV Usage Score */}
      <div className="grid grid-cols-[1fr_1.4fr] gap-4 mt-6 items-start">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-1">EVV Usage Score</div>
          <p className="text-[12px] text-[var(--muted)] mb-4">
            Required minimum: {profile.usageThreshold}% per fiscal quarter
          </p>
          <div className="flex items-end gap-2 mb-1">
            <div
              className={
                'font-display font-extrabold text-[34px] leading-none ' +
                (currentQuarter.score >= profile.usageThreshold ? 'text-[var(--success)]' : 'text-[var(--danger)]')
              }
            >
              {currentQuarter.score}%
            </div>
            <div className="text-[12px] text-[var(--muted)] mb-1">{currentQuarter.quarter}</div>
          </div>
          <span
            className={
              'inline-block text-[11px] font-display font-bold px-2.5 py-1 rounded-full ' +
              (currentQuarter.score >= profile.usageThreshold
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : 'bg-[var(--danger-soft)] text-[var(--danger)]')
            }
          >
            {currentQuarter.score >= profile.usageThreshold ? 'Compliant' : 'Below threshold'}
          </span>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Usage score by quarter</div>
          <BarChart
            data={profile.usageHistory.map((q) => ({ label: q.quarter, value: q.score }))}
            unit="%"
            scaleMax={100}
            threshold={profile.usageThreshold}
          />
        </div>
      </div>

      {/* Enforcement ladder */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="font-display font-extrabold text-[14.5px] mb-1">Enforcement ladder</div>
        <p className="text-[12.5px] text-[var(--muted)] mb-4">
          {nonCompliantStreak === 0
            ? "No active corrective action — the agency is currently compliant."
            : `${nonCompliantStreak} consecutive non-compliant quarter(s) — see the current tier below.`}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {profile.enforcementLadder.map((tier) => {
            const active = tier.tier === nonCompliantStreak;
            return (
              <div
                key={tier.tier}
                className={
                  'rounded-[12px] px-4 py-3.5 border ' +
                  (active
                    ? 'border-[var(--danger)] bg-[var(--danger-soft)]'
                    : 'border-[var(--border)] bg-[oklch(99%_0.004_85)]')
                }
              >
                <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">
                  Tier {tier.tier}
                </div>
                <div className="font-display font-bold text-[13px] mb-1.5">{tier.label}</div>
                <div className="text-[12px] text-[var(--muted)]">{tier.consequence}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cures Act 6 elements */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="font-display font-extrabold text-[14.5px] mb-1">
          The 6 required EVV data elements
        </div>
        <p className="text-[12.5px] text-[var(--muted)] mb-4">
          Federal 21st Century Cures Act, Sec. 12006 — every state&rsquo;s EVV program, {profile.stateName}{' '}
          included, is built around capturing these six elements on every visit.
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
          {CURES_ACT_ELEMENTS.map((el) => (
            <div key={el.id} className="flex items-center gap-2.5">
              <span className="w-[18px] h-[18px] rounded-full bg-[var(--success-soft)] text-[var(--success)] flex items-center justify-center shrink-0">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span className="text-[13px] font-display font-semibold">{el.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Visit maintenance queue */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <div className="font-display font-extrabold text-[14.5px] mb-1">Visit maintenance queue</div>
          <p className="text-[12px] text-[var(--muted)]">
            {profile.visitMaintenanceWindowDays}-day window to correct a visit before it locks
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-2">
          <div className="grid grid-cols-[1.1fr_1.1fr_1fr_1.6fr_1fr_1.3fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
            <div>Client</div>
            <div>Caregiver</div>
            <div>Service date</div>
            <div>Reason code</div>
            <div>Window</div>
            <div>Action</div>
          </div>

          {maintenanceQueue.length === 0 ? (
            <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
              Nothing needs correction — every flagged visit has been resolved.
            </div>
          ) : (
            maintenanceQueue.map((v) => {
              const client = clients.find((c) => c.id === v.clientId);
              const caregiver = caregivers.find((c) => c.id === v.caregiverId);
              const urgency = maintenanceUrgency(v.remaining);
              const overdue = v.remaining < 0;
              return (
                <div
                  key={v.id}
                  className="grid grid-cols-[1.1fr_1.1fr_1fr_1.6fr_1fr_1.3fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
                >
                  <div className="font-display font-bold text-[13.5px]">{client?.name}</div>
                  <div>{caregiver?.name}</div>
                  <div className="text-[12px] text-[var(--muted)]">{formatServiceDate(v.serviceDate)}</div>
                  <div>
                    <div className="text-[12.5px] font-display font-semibold">
                      {v.evv.exception} — {profile.reasonCodes[v.evv.exception]?.label}
                    </div>
                    {v.evv.note && (
                      <div className="text-[11.5px] text-[var(--muted)] mt-0.5 leading-snug">{v.evv.note}</div>
                    )}
                  </div>
                  <div>
                    <span className={'inline-block text-[11px] font-display font-bold px-2.5 py-1 rounded-full ' + urgency.className}>
                      {urgency.label}
                    </span>
                  </div>
                  <div>
                    <ExceptionActionButton visitId={v.id} variant={overdue ? 'vmur' : 'review'} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {closedOutQueue.length > 0 && (
          <p className="text-[12px] text-[var(--muted)] mt-2.5">
            {closedOutQueue.length} previously flagged visit{closedOutQueue.length === 1 ? '' : 's'} already
            resolved or submitted for a Visit Maintenance Unlock Request.
          </p>
        )}
      </div>

      {/* Reason codes reference */}
      <div className="mt-4">
        <div className="font-display font-extrabold text-[14.5px] mb-2">EVV reason codes reference</div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[0.6fr_2fr_1fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
            <div>Code</div>
            <div>Meaning</div>
            <div>Note required</div>
          </div>
          {Object.entries(profile.reasonCodes).map(([code, info]) => (
            <div
              key={code}
              className="grid grid-cols-[0.6fr_2fr_1fr] px-5 py-2.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
            >
              <div className="font-display font-bold">{code}</div>
              <div>{info.label}</div>
              <div className="text-[12px] text-[var(--muted)]">{info.requiresNote ? 'Yes' : '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
