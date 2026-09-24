import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/actions/auth';
import {
  getOrganization,
  getLocationRevenueSummary,
  getCaregivers,
  getClients,
  getEvvCredentials,
  getSyncLog,
  getVisits,
  getBillingSummaryForPlatform,
  logPlatformAdminAccess,
} from '@/lib/queries';
import { getComplianceProfile } from '@/lib/state-compliance';

// Per-tenant detail dashboard for the platform team — reached by clicking
// an agency's name on /platform. Same read-only, cross-tenant visibility
// as that page (see its top comment and lib/permissions.js's
// 'platform.organizations.view' entry): this is a deeper view of an
// agency the platform admin can already see in aggregate, not a new
// access tier. NOTHING on this page writes to the tenant — every query
// below is a plain read, reusing the same tenant-scoped functions the
// agency's own /admin pages use (getLocationRevenueSummary,
// getCaregivers, getEvvCredentials, getSyncLog), just called here with an
// organizationId taken from the URL instead of the caller's own session.
// EVV credentials are read only for their non-secret fields (status,
// environment, aggregator, office identifiers) — clientIdEnc/
// clientSecretEnc are never rendered or logged from here.
const EVV_STATUS_LABEL = {
  not_started: 'Not started',
  testing: 'Testing',
  passed: 'Sandbox passed',
  live: 'Live',
  disabled: 'Disabled',
};
const EVV_STATUS_TONE = {
  not_started: 'neutral',
  testing: 'amber',
  passed: 'amber',
  live: 'success',
  disabled: 'danger',
};
const ORG_STATUS_TONE = { trial: 'amber', active: 'success', suspended: 'danger' };
const SYNC_STATUS_LABEL = {
  pending: 'Queued',
  sent: 'Awaiting state',
  acknowledged: 'Confirmed',
  failed: 'Failed',
};
const SYNC_STATUS_TONE = { pending: 'neutral', sent: 'amber', acknowledged: 'success', failed: 'danger' };
const CAREGIVER_STATUS_LABEL = {
  applicant: 'Applicant',
  onboarding: 'Onboarding',
  active: 'Active',
  'on-leave': 'On leave',
  inactive: 'Inactive',
};

const TONE_CLASSES = {
  neutral: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
  amber: 'bg-[var(--amber-soft)] text-[var(--amber)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
};

function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-display font-bold whitespace-nowrap ' +
        (TONE_CLASSES[tone] || TONE_CLASSES.neutral)
      }
    >
      {children}
    </span>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
      <div className="font-display font-extrabold text-[14.5px]">{title}</div>
      {subtitle && <p className="text-[12px] text-[var(--muted)] mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function StatTile({ label, value, tone = 'neutral' }) {
  const valueClasses = {
    neutral: 'text-[var(--text)]',
    amber: 'text-[var(--amber)]',
    success: 'text-[var(--success)]',
    danger: 'text-[var(--danger)]',
  };
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
        {label}
      </div>
      <div className={'font-display font-extrabold text-[22px] ' + (valueClasses[tone] || valueClasses.neutral)}>
        {value}
      </div>
    </div>
  );
}

function currency(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default async function PlatformOrganizationDetailPage({ params }) {
  const session = await requireSession(['PLATFORM_ADMIN']);
  const { id } = await params;

  const organization = await getOrganization(id);
  if (!organization) notFound();

  const [locations, caregivers, clients, evvCredentials, syncLog, visits, billing] = await Promise.all([
    getLocationRevenueSummary(id),
    getCaregivers(id),
    getClients(id),
    getEvvCredentials(id),
    getSyncLog(id, 15),
    getVisits(id),
    getBillingSummaryForPlatform(id),
  ]);

  await logPlatformAdminAccess(session.userId, 'view_organization_detail', `Viewed "${organization.name}" (org ${id})`);

  const complianceProfile = getComplianceProfile(organization.state);
  const openExceptions = visits.filter((v) => v.evv?.exception && !v.resolved);
  const unassignedClients = clients.filter((c) => !c.locationId);

  const caregiverByStatus = caregivers.reduce((acc, cg) => {
    acc[cg.status] = (acc[cg.status] || 0) + 1;
    return acc;
  }, {});

  const providerInfoDone = Boolean(
    organization.medicaidProviderNumber && organization.npi && organization.stateLicenseNumber
  );
  const credentialsConfigured = Boolean(evvCredentials);
  const certificationPassed = evvCredentials?.status === 'passed' || evvCredentials?.status === 'live';
  const evvLive = evvCredentials?.status === 'live';
  const checklist = [
    { label: 'Agency account created', done: true },
    { label: 'Provider info on file', done: providerInfoDone },
    { label: 'Provider-enrollment attestation', done: organization.providerEnrollmentAttested },
    { label: 'Business Associate Agreement signed', done: organization.baaSigned },
    { label: 'EVV credentials configured', done: credentialsConfigured },
    { label: 'Sandbox certification passed', done: certificationPassed },
    { label: 'Live in production', done: evvLive },
  ];
  const doneCount = checklist.filter((s) => s.done).length;

  const totalRevenue = locations.reduce((sum, l) => sum + l.revenue, 0);

  return (
    <div>
      <Link href="/platform" className="inline-flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Platform overview
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">{organization.name}</h1>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            {organization.state || '—'} · created {new Date(organization.createdAt).toLocaleDateString('en-US')}
          </p>
        </div>
        <Badge tone={ORG_STATUS_TONE[organization.status] || 'neutral'}>{organization.status}</Badge>
      </div>

      <div className="grid grid-cols-4 gap-3 mt-6">
        <StatTile label="Locations" value={locations.length} />
        <StatTile label="Active caregivers" value={caregiverByStatus.active || 0} />
        <StatTile
          label="Open EVV exceptions"
          value={openExceptions.length}
          tone={openExceptions.length > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Pending revenue"
          value={currency(billing.pendingAmount)}
          tone={billing.pendingAmount > 0 ? 'amber' : 'neutral'}
        />
      </div>

      <Section title="Go-live checklist" subtitle={`${doneCount} of ${checklist.length} complete`}>
        <div className="h-2 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden mb-4">
          <div
            className={'h-full rounded-full ' + (doneCount === checklist.length ? 'bg-[var(--success)]' : 'bg-[var(--accent-strong)]')}
            style={{ width: `${(doneCount / checklist.length) * 100}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          {checklist.map((step) => (
            <div key={step.label} className="flex items-center gap-2">
              <span
                className={
                  'w-[16px] h-[16px] rounded-full flex items-center justify-center shrink-0 ' +
                  (step.done ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]')
                }
              >
                {step.done && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className={step.done ? '' : 'text-[var(--muted)]'}>{step.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <Section title="Compliance & EVV">
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge tone={EVV_STATUS_TONE[evvCredentials?.status] || 'neutral'}>
              {EVV_STATUS_LABEL[evvCredentials?.status] || 'Not configured'}
            </Badge>
            {evvCredentials?.environment && <Badge>{evvCredentials.environment}</Badge>}
            {evvCredentials?.aggregator && <Badge>{evvCredentials.aggregator}</Badge>}
          </div>

          {complianceProfile ? (
            <p className="text-[12px] text-[var(--muted)] mb-3">
              {complianceProfile.stateName} compliance profile on file — {complianceProfile.usageThreshold}%
              quarterly usage minimum, {complianceProfile.visitMaintenanceWindowDays}-day visit-correction window.
            </p>
          ) : (
            <p className="text-[12px] text-[var(--amber)] font-display font-semibold mb-3">
              No compliance profile configured for {organization.state || 'this agency’s state'} yet — this
              agency&rsquo;s own Compliance Center will show a &ldquo;not configured&rdquo; notice until one is
              built (see the multi-state-expansion architecture doc).
            </p>
          )}

          {openExceptions.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
                Open exceptions ({openExceptions.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {openExceptions.slice(0, 5).map((v) => (
                  <div key={v.id} className="text-[12.5px] flex justify-between gap-2">
                    <span>Code {v.evv.exception}</span>
                    <span className="text-[var(--muted)]">{v.serviceDate}</span>
                  </div>
                ))}
                {openExceptions.length > 5 && (
                  <div className="text-[11.5px] text-[var(--muted)]">+{openExceptions.length - 5} more</div>
                )}
              </div>
            </div>
          )}

          <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
            Recent sync activity
          </div>
          {syncLog.length === 0 ? (
            <p className="text-[12.5px] text-[var(--muted)]">No EVV sync activity yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {syncLog.slice(0, 8).map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="truncate">{row.clientName || row.operation}</span>
                  <Badge tone={SYNC_STATUS_TONE[row.status] || 'neutral'}>{SYNC_STATUS_LABEL[row.status] || row.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Financial snapshot" subtitle="Org-wide, including clients with no location assigned">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">Pending</div>
              <div className="font-display font-extrabold text-[19px]">{currency(billing.pendingAmount)}</div>
              <div className="text-[11.5px] text-[var(--muted)]">{billing.pendingLineCount} line{billing.pendingLineCount === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">Paid to date</div>
              <div className="font-display font-extrabold text-[19px]">{currency(billing.paidAmount)}</div>
            </div>
          </div>
          {billing.unratedLineCount > 0 && (
            <p className="text-[12px] text-[var(--amber)] font-display font-semibold mb-3">
              {billing.unratedLineCount} billing line{billing.unratedLineCount === 1 ? '' : 's'} with no rate on
              file — excluded from revenue until an authorization rate is set.
            </p>
          )}
          <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
            Location revenue rollup
          </div>
          <div className="text-[12.5px] text-[var(--muted)]">
            {locations.length} location{locations.length === 1 ? '' : 's'} · {currency(totalRevenue)} billed
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <Section title="Multi-location breakdown" subtitle={locations.length === 0 ? undefined : `${locations.length} location${locations.length === 1 ? '' : 's'}`}>
          {locations.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">This agency has not set up any locations yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center justify-between gap-3 text-[13px] border-b border-[oklch(93%_0.01_85)] last:border-none pb-2.5 last:pb-0">
                  <div>
                    <div className="font-display font-bold">{loc.name}</div>
                    <div className="text-[11.5px] text-[var(--muted)]">
                      {loc.ratedLineCount} rated / {loc.unratedLineCount} unrated
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-bold">{currency(loc.revenue)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Workforce health" subtitle={`${caregivers.length} caregivers · ${clients.length} clients`}>
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {['active', 'onboarding', 'applicant', 'on-leave', 'inactive'].map((status) => (
              <div key={status} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--muted)]">{CAREGIVER_STATUS_LABEL[status]}</span>
                <span className="font-display font-bold">{caregiverByStatus[status] || 0}</span>
              </div>
            ))}
          </div>
          {unassignedClients.length > 0 && (
            <p className="text-[12px] text-[var(--muted)]">
              {unassignedClients.length} client{unassignedClients.length === 1 ? '' : 's'} not assigned to a
              location.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
