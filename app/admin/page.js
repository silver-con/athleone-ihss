import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getReferrals,
  getClients,
  getCaregivers,
  getVisits,
  getLocation,
  getOrganization,
  getBillingSummary,
  getAllLatestChecks,
  getEvvCredentials,
  getSyncLog,
  getLocationRevenueSummary,
  CHECK_TYPES,
} from '@/lib/queries';
import { getComplianceProfile } from '@/lib/state-compliance';
import StatTile from '@/components/StatTile';
import BarChart from '@/components/charts/BarChart';
import StatusBar from '@/components/charts/StatusBar';
import { REFERRAL_STATUS_ORDER, statusInfo } from '@/lib/styles';
import { WEEK_DAYS } from '@/lib/data';

const STATUS_FILL = {
  new: 'oklch(72% 0.13 55)',
  'in-progress': 'var(--accent-strong)',
  completed: 'var(--success)',
};

const CAREGIVER_STATUS_LABEL = {
  applicant: 'Applicant',
  onboarding: 'Onboarding',
  active: 'Active',
  'on-leave': 'On leave',
  inactive: 'Inactive',
};

// Same "missing or overdue" bar the caregiver roster (app/admin/caregivers/
// page.js's credentialingState) already uses to flag a row red — reused
// here only as a yes/no gate to count how many caregivers need a look,
// not to duplicate that page's fuller "due soon" breakdown.
function caregiverHasCredentialingGap(caregiverId, checks) {
  const mine = checks.filter((c) => c.caregiverId === caregiverId);
  const missing = CHECK_TYPES.some((t) => !mine.some((c) => c.checkType === t.key));
  const overdue = mine.some((c) => c.nextDueOn && new Date(c.nextDueOn) < new Date());
  return missing || overdue;
}

const currency = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default async function AdminOverviewPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  // session.locationId is null for every ADMIN account today (no UI yet
  // creates a location-scoped one — see app/admin/locations/page.js), so
  // this is currently a no-op; threading it through now means a future
  // location-scoped manager role gets a correctly filtered dashboard for
  // free. The org admin's own "full view of all locations" requirement is
  // exactly what a null locationId already gives — see getLocationRevenueSummary
  // in lib/queries.js for the cross-location rollup this page links to.
  const [referrals, clients, caregivers, visits, scopedLocation, organization, billing, checks] =
    await Promise.all([
      getReferrals(session.organizationId),
      getClients(session.organizationId, session.locationId),
      getCaregivers(session.organizationId, session.locationId),
      getVisits(session.organizationId, session.locationId),
      session.locationId ? getLocation(session.organizationId, session.locationId) : null,
      getOrganization(session.organizationId),
      getBillingSummary(session.organizationId, session.locationId),
      getAllLatestChecks(session.organizationId, session.locationId),
    ]);

  // 2026-09-21: EVV credentials/sync status and the cross-location revenue
  // rollup are deliberately fetched (and shown) for ADMIN only — this
  // dashboard does not grant a LOCATION_ADMIN any visibility the rest of
  // the app doesn't already give them. admin.evv.sync.view and
  // admin.locations.view are both ADMIN-only in lib/permissions.js; this
  // just keeps the dashboard from becoming a side door around that.
  const isOrgAdmin = session.role === 'ADMIN';
  const [evvCredentials, syncLog, locations] = isOrgAdmin
    ? await Promise.all([
        getEvvCredentials(session.organizationId),
        getSyncLog(session.organizationId, 50),
        getLocationRevenueSummary(session.organizationId),
      ])
    : [null, [], []];

  const openReferrals = referrals.filter((r) => r.status !== 'completed').length;
  const activeCaregivers = caregivers.filter((c) => c.status === 'active').length;
  const unassignedClients = clients.filter((c) => !c.assignedCaregiverId);
  const totalAuthHours = clients.reduce((sum, c) => sum + (c.authHoursNum || 0), 0);
  const openExceptions = visits.filter((v) => v.evv?.exception && !v.resolved);
  const onLeaveCaregivers = caregivers.filter((c) => c.status === 'on-leave');

  const complianceProfile = getComplianceProfile(organization?.state);
  const syncFailedCount = syncLog.filter((r) => r.status === 'failed').length;
  const totalLocationRevenue = locations.reduce((sum, l) => sum + l.revenue, 0);
  const totalLocationCommission = locations.reduce((sum, l) => sum + l.commissionAmount, 0);

  const caregiverByStatus = caregivers.reduce((acc, cg) => {
    acc[cg.status] = (acc[cg.status] || 0) + 1;
    return acc;
  }, {});
  const credentialingGapCount = caregivers.filter((cg) =>
    caregiverHasCredentialingGap(cg.id, checks)
  ).length;

  const statusSegments = REFERRAL_STATUS_ORDER.map((key) => {
    const info = statusInfo(key);
    return {
      key,
      label: info.label,
      value: referrals.filter((r) => r.status === key).length,
      color: STATUS_FILL[key],
    };
  });

  const payerCounts = {};
  referrals.forEach((r) => {
    payerCounts[r.payer] = (payerCounts[r.payer] || 0) + 1;
  });
  const payerData = Object.entries(payerCounts).map(([label, value]) => ({ label, value }));

  const caseloadData = caregivers.map((cg) => ({
    label: cg.name,
    value: clients
      .filter((c) => c.assignedCaregiverId === cg.id)
      .reduce((sum, c) => sum + (c.authHoursNum || 0), 0),
  }));

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">
        {scopedLocation ? `${scopedLocation.name} Dashboard` : 'Admin Dashboard'}
      </h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        {scopedLocation
          ? `Caregivers and clients at ${scopedLocation.name} — referrals below are the organization’s shared intake queue`
          : 'Agency-wide overview across referrals, caregivers and active clients'}
      </p>

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={clients.length} label="Active clients" />
        <StatTile num={openReferrals} label="Open referrals" />
        <StatTile
          num={unassignedClients.length}
          label="Unassigned clients"
          accent={unassignedClients.length > 0 ? 'oklch(58% 0.13 55)' : undefined}
        />
        <StatTile num={activeCaregivers} label="Active caregivers" />
        <StatTile num={totalAuthHours + ' hrs'} label="Authorized hours / wk" />
        <StatTile
          num={openExceptions.length}
          label="Open EVV exceptions"
          accent={openExceptions.length > 0 ? 'var(--danger)' : undefined}
        />
        <StatTile
          num={currency(billing.pendingAmount)}
          label="Pending revenue"
          accent={billing.pendingAmount > 0 ? 'var(--amber)' : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Referrals by status</div>
          <StatusBar segments={statusSegments} />
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Referrals by payer</div>
          <BarChart data={payerData} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Caseload hours by caregiver</div>
          <BarChart data={caseloadData} unit=" hrs" barColor="var(--accent-strong)" />
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14.5px] mb-4">Needs attention</div>
          {unassignedClients.length === 0 && openExceptions.length === 0 && onLeaveCaregivers.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">
              Nothing needs attention right now — every client is assigned and there are no open EVV
              exceptions.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {unassignedClients.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display font-bold text-[13.5px]">{c.name}</div>
                    <div className="text-[12px] text-[var(--muted)]">{c.payer} · {c.authHours} · unassigned</div>
                  </div>
                  <Link
                    href="/admin/clients"
                    className="text-[12px] font-display font-bold text-[var(--accent)] whitespace-nowrap"
                  >
                    Assign →
                  </Link>
                </div>
              ))}
              {onLeaveCaregivers.map((cg) => (
                <div key={cg.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display font-bold text-[13.5px]">{cg.name}</div>
                    <div className="text-[12px] text-[var(--muted)]">On leave · caseload needs coverage</div>
                  </div>
                  <Link
                    href="/admin/schedule"
                    className="text-[12px] font-display font-bold text-[var(--accent)] whitespace-nowrap"
                  >
                    Schedule →
                  </Link>
                </div>
              ))}
              {openExceptions.map((v) => {
                const client = clients.find((c) => c.id === v.clientId);
                const day = WEEK_DAYS.find((d) => d.key === v.day);
                return (
                  <div key={v.id} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-display font-bold text-[13.5px]">{client?.name}</div>
                      <div className="text-[12px] text-[var(--muted)]">
                        EVV exception (code {v.evv.exception}) · {day ? `${day.label} ${v.start}` : v.serviceDate}
                      </div>
                    </div>
                    <Link
                      href="/admin/compliance"
                      className="text-[12px] font-display font-bold text-[var(--danger)] whitespace-nowrap"
                    >
                      Review →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-extrabold text-[14.5px]">Compliance &amp; EVV</div>
            <Link href="/admin/compliance" className="text-[12px] font-display font-bold text-[var(--accent)]">
              Compliance Center →
            </Link>
          </div>
          {complianceProfile ? (
            <p className="text-[12.5px] text-[var(--muted)] mb-3">
              {complianceProfile.stateName} compliance profile on file — {complianceProfile.usageThreshold}%
              quarterly usage minimum, {complianceProfile.visitMaintenanceWindowDays}-day visit-correction window.
            </p>
          ) : (
            <p className="text-[12.5px] text-[var(--amber)] font-display font-semibold mb-3">
              No compliance profile configured for {organization?.state || 'this agency’s state'} yet — the
              Compliance Center will show a &ldquo;not configured&rdquo; notice until one is built.
            </p>
          )}
          {isOrgAdmin ? (
            <>
              <div className="flex items-center justify-between text-[13px] pt-3 border-t border-[oklch(93%_0.01_85)]">
                <span className="text-[var(--muted)]">EVV connection</span>
                <span className="font-display font-bold">
                  {evvCredentials?.status
                    ? `${evvCredentials.status}${evvCredentials.aggregator ? ` · ${evvCredentials.aggregator}` : ''}`
                    : 'Not configured'}
                </span>
              </div>
              {syncFailedCount > 0 && (
                <div className="flex items-center justify-between text-[13px] mt-1.5">
                  <span className="text-[var(--muted)]">Failed syncs (last 50)</span>
                  <span className="font-display font-bold text-[var(--danger)]">{syncFailedCount}</span>
                </div>
              )}
              <Link
                href="/admin/evv/sync"
                className="inline-block text-[12px] font-display font-bold text-[var(--accent)] mt-2.5"
              >
                State transmission status →
              </Link>
            </>
          ) : (
            <p className="text-[12px] text-[var(--muted)] pt-3 border-t border-[oklch(93%_0.01_85)]">
              EVV connection details are managed by your organization admin.
            </p>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-extrabold text-[14.5px]">Financial snapshot</div>
            <Link href="/admin/finance" className="text-[12px] font-display font-bold text-[var(--accent)]">
              Finance →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">
                Pending
              </div>
              <div className="font-display font-extrabold text-[19px]">{currency(billing.pendingAmount)}</div>
              <div className="text-[11.5px] text-[var(--muted)]">
                {billing.pendingLineCount} line{billing.pendingLineCount === 1 ? '' : 's'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">
                Paid to date
              </div>
              <div className="font-display font-extrabold text-[19px]">{currency(billing.paidAmount)}</div>
            </div>
          </div>
          {billing.unratedLineCount > 0 && (
            <p className="text-[12px] text-[var(--amber)] font-display font-semibold">
              {billing.unratedLineCount} billing line{billing.unratedLineCount === 1 ? '' : 's'} with no rate on
              file — excluded from these totals until an authorization rate is set.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-extrabold text-[14.5px]">Workforce health</div>
            <Link href="/admin/caregivers" className="text-[12px] font-display font-bold text-[var(--accent)]">
              Roster →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {['active', 'onboarding', 'applicant', 'on-leave', 'inactive'].map((status) => (
              <div key={status} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--muted)]">{CAREGIVER_STATUS_LABEL[status]}</span>
                <span className="font-display font-bold">{caregiverByStatus[status] || 0}</span>
              </div>
            ))}
          </div>
          {credentialingGapCount > 0 ? (
            <p className="text-[12px] text-[var(--danger)] font-display font-semibold pt-3 border-t border-[oklch(93%_0.01_85)]">
              {credentialingGapCount} caregiver{credentialingGapCount === 1 ? '' : 's'} missing or overdue on a
              required check.
            </p>
          ) : (
            <p className="text-[12px] text-[var(--muted)] pt-3 border-t border-[oklch(93%_0.01_85)]">
              Every caregiver&rsquo;s required checks are on file.
            </p>
          )}
        </div>

        {isOrgAdmin ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="font-display font-extrabold text-[14.5px]">Locations</div>
              <Link href="/admin/locations" className="text-[12px] font-display font-bold text-[var(--accent)]">
                Manage →
              </Link>
            </div>
            {locations.length === 0 ? (
              <p className="text-[13px] text-[var(--muted)]">
                No locations set up yet — every caregiver and client is agency-wide.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-[13px] mb-2.5">
                  <span className="text-[var(--muted)]">{locations.length} location{locations.length === 1 ? '' : 's'}</span>
                  <span className="font-display font-bold">
                    {currency(totalLocationRevenue)} billed · {currency(totalLocationCommission)} commission
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {locations.slice(0, 5).map((loc) => (
                    <div key={loc.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="truncate">{loc.name}</span>
                      <span className="text-[var(--muted)] whitespace-nowrap">{currency(loc.revenue)}</span>
                    </div>
                  ))}
                  {locations.length > 5 && (
                    <div className="text-[11.5px] text-[var(--muted)]">+{locations.length - 5} more</div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
