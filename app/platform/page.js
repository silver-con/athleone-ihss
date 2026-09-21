import { requireSession } from '@/actions/auth';
import { getAllOrganizationsForPlatform, logPlatformAdminAccess } from '@/lib/queries';
import CreateOrganizationForm from '@/components/platform/CreateOrganizationForm';

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
// EVV_STATUS_LABEL / EVV_STATUS_TONE mirror the same status vocabulary
// used on the tenant's own /admin/evv pages (not_started / testing /
// passed / live / disabled) so an agency's status here always means the
// same thing it means to that agency.
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

const ORG_STATUS_TONE = {
  trial: 'amber',
  active: 'success',
  suspended: 'danger',
};

function Badge({ tone = 'neutral', children }) {
  const toneClasses = {
    neutral: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
    amber: 'bg-[var(--amber-soft)] text-[var(--amber)]',
    success: 'bg-[var(--success-soft)] text-[var(--success)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  };
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-display font-bold whitespace-nowrap ' +
        (toneClasses[tone] || toneClasses.neutral)
      }
    >
      {children}
    </span>
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

export default async function PlatformDashboardPage() {
  const session = await requireSession(['PLATFORM_ADMIN']);
  const organizations = await getAllOrganizationsForPlatform();
  await logPlatformAdminAccess(session.userId, 'view_dashboard');

  const totalCount = organizations.length;
  const liveCount = organizations.filter((o) => o.evvLive).length;
  const suspendedCount = organizations.filter((o) => o.status === 'suspended').length;
  const failingCount = organizations.filter((o) => o.evvFailedCount > 0).length;

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Platform overview</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Every agency on Hearth, their go-live progress, and EVV sync health. Onboarding a new
        agency below is the only thing here that writes anything — nothing on this page can edit
        an agency that already exists; see that agency&rsquo;s own team for anything that needs to
        change.
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

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl mt-6 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left border-b border-[var(--border)] bg-[oklch(97%_0.006_85)]">
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Agency
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Account
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Go-live checklist
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                EVV status
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Failed syncs
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted)]">
                  No agencies yet.
                </td>
              </tr>
            )}
            {organizations.map((org) => (
              <tr key={org.id} className="border-b border-[var(--border)] last:border-b-0 align-top">
                <td className="px-4 py-3.5">
                  <div className="font-display font-bold text-[13.5px]">{org.name}</div>
                  {!org.providerInfoDone && (
                    <div className="text-[11.5px] text-[var(--muted)] mt-0.5">Provider info incomplete</div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={ORG_STATUS_TONE[org.status] || 'neutral'}>{org.status}</Badge>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden shrink-0">
                      <div
                        className={
                          'h-full rounded-full ' +
                          (org.onboardingStepsDone === org.onboardingStepsTotal
                            ? 'bg-[var(--success)]'
                            : 'bg-[var(--accent-strong)]')
                        }
                        style={{ width: `${(org.onboardingStepsDone / org.onboardingStepsTotal) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11.5px] text-[var(--muted)] whitespace-nowrap">
                      {org.onboardingStepsDone} of {org.onboardingStepsTotal}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={EVV_STATUS_TONE[org.evvStatus] || 'neutral'}>
                    {EVV_STATUS_LABEL[org.evvStatus] || 'Not configured'}
                  </Badge>
                </td>
                <td className="px-4 py-3.5">
                  {org.evvFailedCount > 0 ? (
                    <span className="font-display font-bold text-[var(--danger)]">{org.evvFailedCount}</span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-[var(--muted)] whitespace-nowrap">
                  {new Date(org.createdAt).toLocaleDateString('en-US')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
