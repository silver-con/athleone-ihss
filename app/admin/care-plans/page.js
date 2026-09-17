import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllServiceAuthorizations, getClients } from '@/lib/queries';
import StatTile from '@/components/StatTile';

const STATUS_STYLES = {
  approved: 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]',
  pending: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]',
  denied: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]',
  expired: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
};

export default async function AdminCarePlansPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [authorizations, clients] = await Promise.all([
    getAllServiceAuthorizations(session.organizationId),
    getClients(session.organizationId),
  ]);

  const withAuth = new Set(authorizations.map((a) => a.clientId));
  const clientsMissingAuth = clients.filter((c) => !withAuth.has(c.id));
  const expiringSoon = authorizations.filter((a) => {
    if (a.status !== 'approved' || !a.endDate) return false;
    const days = (new Date(a.endDate) - new Date()) / 86400000;
    return days >= 0 && days <= 30;
  });

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Care Plans</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Every client&rsquo;s payer service authorization in one place — service code, units, date range, and
        the exact task list the payer approved. This is what a caregiver&rsquo;s visit checklist and the
        Finance ledger both trace back to.
      </p>

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={authorizations.length} label="Authorizations on file" />
        <StatTile
          num={clientsMissingAuth.length}
          label="Clients with no authorization"
          accent={clientsMissingAuth.length > 0 ? 'oklch(58% 0.13 55)' : undefined}
        />
        <StatTile
          num={expiringSoon.length}
          label="Expiring within 30 days"
          accent={expiringSoon.length > 0 ? 'var(--danger)' : undefined}
        />
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.3fr_1fr_1.2fr_1fr_1fr_0.9fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Payer</div>
          <div>Service code</div>
          <div>Units / wk</div>
          <div>Effective through</div>
          <div>Status</div>
        </div>

        {authorizations.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            No service authorizations on file yet. Open a client and add one from their Care Plan page.
          </div>
        )}

        {authorizations.map((a) => (
          <Link
            key={a.id}
            href={`/admin/clients/${a.clientId}/care-plan`}
            className="grid grid-cols-[1.3fr_1fr_1.2fr_1fr_1fr_0.9fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none hover:bg-[oklch(97%_0.006_85)]"
          >
            <div className="font-display font-bold text-[14px] text-[var(--accent)]">{a.clientName}</div>
            <div>{a.payer}</div>
            <div>{a.serviceCode} · {a.modifierCodes || '—'}</div>
            <div>{a.totalUnitsPerWeek ?? '—'}</div>
            <div>{a.endDate}</div>
            <div>
              <span
                className={
                  'text-[10.5px] font-display font-bold uppercase tracking-wide px-2 py-1 rounded-full ' +
                  (STATUS_STYLES[a.status] || STATUS_STYLES.pending)
                }
              >
                {a.status}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {clientsMissingAuth.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
          <div className="font-display font-extrabold text-[14.5px] mb-3">Needs an authorization on file</div>
          <div className="flex flex-col gap-2">
            {clientsMissingAuth.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="text-[13.5px] font-display font-bold">{c.name}</div>
                <Link
                  href={`/admin/clients/${c.id}/care-plan`}
                  className="text-[12px] font-display font-bold text-[var(--accent)]"
                >
                  Add authorization →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
