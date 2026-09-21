import { requireSession } from '@/actions/auth';
import { getAllOrganizationsForPlatform, logPlatformAdminAccess } from '@/lib/queries';
import CreateOrganizationForm from '@/components/platform/CreateOrganizationForm';
import OrganizationsTable from '@/components/platform/OrganizationsTable';

// Platform admin dashboard — architecture spec §3, scoped down to
// view-only per the decision recorded in deferred-backlog.md, with one
// deliberate exception added 2026-09-17: onboarding a brand-new agency
// (see actions/platform.js's createOrganizationAction and the form at the
// bottom of this page). That's the only thing on this page that writes
// anything — and it only ever creates a new organization, never touches
// one that already exists. Suspending/reactivating an existing agency,
// editing its records, or logging in as it ("impersonation") are all
// still deferred — see deferred-backlog.md if/when one of those gets
// built, since each is its own access-control decision, not a small
// addition to this page.
//
// 2026-09-21: extended from a flat read-only table into a controlled
// dashboard — search/filter/sort over the agency list (OrganizationsTable,
// a client component so those interactions don't round-trip the server),
// four new fleet-wide stat tiles (open EVV exceptions, agencies needing
// attention, agencies with locations, total pending revenue), and each
// agency's name now links to its own detail dashboard
// (app/platform/organizations/[id]/page.js) for the compliance/financial/
// workforce drill-down that used to require asking that agency's own team.
// Still nothing here can edit an existing tenant — see that page's own
// top comment for the same boundary repeated at the point where it would
// be easiest to accidentally cross.
export default async function PlatformDashboardPage() {
  const session = await requireSession(['PLATFORM_ADMIN']);
  const organizations = await getAllOrganizationsForPlatform();
  await logPlatformAdminAccess(session.userId, 'view_dashboard');

  const totalCount = organizations.length;
  const liveCount = organizations.filter((o) => o.evvLive).length;
  const suspendedCount = organizations.filter((o) => o.status === 'suspended').length;
  const failingCount = organizations.filter((o) => o.evvFailedCount > 0).length;
  const openExceptionTotal = organizations.reduce((sum, o) => sum + o.openExceptionCount, 0);
  const needsAttentionCount = organizations.filter(
    (o) => o.status === 'suspended' || o.evvFailedCount > 0 || o.openExceptionCount > 0 || !o.providerInfoDone
  ).length;
  const multiLocationCount = organizations.filter((o) => o.locationCount > 1).length;
  const pendingRevenueTotal = organizations.reduce((sum, o) => sum + o.billingPendingAmount, 0);

  const currency = (n) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Platform overview</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Every agency on Hearth, their go-live progress, EVV sync health, footprint, and pending
        revenue. Onboarding a new agency below is the only thing here that writes anything —
        nothing on this page can edit an agency that already exists; see that agency&rsquo;s own
        team for anything that needs to change.
      </p>

      <div className="grid grid-cols-4 gap-3 mt-6">
        <StatTile label="Agencies" value={totalCount} />
        <StatTile label="Live in production" value={liveCount} tone={liveCount > 0 ? 'success' : 'neutral'} />
        <StatTile label="Suspended" value={suspendedCount} tone={suspendedCount > 0 ? 'danger' : 'neutral'} />
        <StatTile
          label="With failed EVV syncs"
          value={failingCount}
          tone={failingCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="grid grid-cols-4 gap-3 mt-3">
        <StatTile
          label="Open EVV exceptions (fleet-wide)"
          value={openExceptionTotal}
          tone={openExceptionTotal > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Agencies needing attention"
          value={needsAttentionCount}
          tone={needsAttentionCount > 0 ? 'amber' : 'success'}
        />
        <StatTile label="Multi-location agencies" value={multiLocationCount} />
        <StatTile
          label="Pending revenue (fleet-wide)"
          value={currency(pendingRevenueTotal)}
          tone={pendingRevenueTotal > 0 ? 'amber' : 'neutral'}
        />
      </div>

      <OrganizationsTable organizations={organizations} />

      {session.platformRole === 'full' ? (
        <CreateOrganizationForm />
      ) : (
        <p className="text-[12.5px] text-[var(--muted)] mt-6">
          Onboarding a new agency needs a full admin &mdash; ask one on your team.
        </p>
      )}
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
      <div className="text-[11.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
        {label}
      </div>
      <div className={'font-display font-extrabold text-[26px] ' + (valueClasses[tone] || valueClasses.neutral)}>
        {value}
      </div>
    </div>
  );
}
