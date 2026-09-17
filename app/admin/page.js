import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferrals, getClients, getCaregivers, getVisits } from '@/lib/queries';
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

export default async function AdminOverviewPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [referrals, clients, caregivers, visits] = await Promise.all([
    getReferrals(session.organizationId),
    getClients(session.organizationId),
    getCaregivers(session.organizationId),
    getVisits(session.organizationId),
  ]);

  const openReferrals = referrals.filter((r) => r.status !== 'completed').length;
  const activeCaregivers = caregivers.filter((c) => c.status === 'active').length;
  const unassignedClients = clients.filter((c) => !c.assignedCaregiverId);
  const totalAuthHours = clients.reduce((sum, c) => sum + (c.authHoursNum || 0), 0);
  const openExceptions = visits.filter((v) => v.evv?.exception && !v.resolved);
  const onLeaveCaregivers = caregivers.filter((c) => c.status === 'on-leave');

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
      <h1 className="font-display font-extrabold text-[24px]">Admin Dashboard</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Agency-wide overview across referrals, caregivers and active clients
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
    </div>
  );
}
