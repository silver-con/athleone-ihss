import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLocationRevenueSummary } from '@/lib/queries';
import CreateLocationForm from '@/components/admin/CreateLocationForm';
import EditLocationForm from '@/components/admin/EditLocationForm';

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminLocationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const locations = await getLocationRevenueSummary(session.organizationId);
  const totalRevenue = locations.reduce((sum, l) => sum + l.revenue, 0);
  const totalCommission = locations.reduce((sum, l) => sum + l.commissionAmount, 0);
  const totalUnrated = locations.reduce((sum, l) => sum + l.unratedLineCount, 0);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Locations</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Every branch or partner operating under your agency&rsquo;s license — billed revenue and the
        commission your agency earns on each, across the whole organization.
      </p>

      <div className="flex flex-wrap gap-3 mt-6">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4 min-w-[160px]">
          <div className="font-display font-extrabold text-[22px]">{locations.length}</div>
          <div className="text-[12px] text-[var(--muted)] mt-1">Locations</div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4 min-w-[160px]">
          <div className="font-display font-extrabold text-[22px]">{money(totalRevenue)}</div>
          <div className="text-[12px] text-[var(--muted)] mt-1">Rated billed revenue</div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4 min-w-[160px]">
          <div className="font-display font-extrabold text-[22px]">{money(totalCommission)}</div>
          <div className="text-[12px] text-[var(--muted)] mt-1">Commission earned</div>
        </div>
        {totalUnrated > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4 min-w-[160px]">
            <div className="font-display font-extrabold text-[22px] text-[oklch(45%_0.11_55)]">{totalUnrated}</div>
            <div className="text-[12px] text-[var(--muted)] mt-1">Unrated billing lines</div>
          </div>
        )}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.6fr_1fr_1.2fr_1.2fr_1fr_1fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Location</div>
          <div>Status</div>
          <div>Commission rate</div>
          <div>Billed revenue</div>
          <div>Commission</div>
          <div>Unrated lines</div>
        </div>

        {locations.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            No locations yet — this agency operates as a single site. Add one below if you&rsquo;re
            onboarding a partner or opening a second branch.
          </div>
        )}

        {locations.map((loc) => (
          <div
            key={loc.id}
            className="grid grid-cols-[1.6fr_1fr_1.2fr_1.2fr_1fr_1fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div>
              <div className="font-display font-bold text-[14.5px]">{loc.name}</div>
              <EditLocationForm location={loc} />
            </div>
            <div className="capitalize">{loc.status}</div>
            <div>{loc.commissionRate}%</div>
            <div>{money(loc.revenue)}</div>
            <div>{money(loc.commissionAmount)}</div>
            <div className={loc.unratedLineCount > 0 ? 'text-[oklch(45%_0.11_55)] font-display font-bold' : ''}>
              {loc.unratedLineCount > 0 ? loc.unratedLineCount : '—'}
            </div>
          </div>
        ))}
      </div>

      <CreateLocationForm />
    </div>
  );
}
