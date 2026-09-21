import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getBillingLines,
  getClients,
  getAllServiceAuthorizations,
  getEvvCredentials,
  getVisitsAwaitingEvvConfirmation,
} from '@/lib/queries';
import StatTile from '@/components/StatTile';
import BillingStatusSelect from '@/components/admin/BillingStatusSelect';
import { createBillingLineAction } from '@/actions/billing';

const STATUS_LABEL = {
  pending: 'Pending review',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  paid: 'Paid',
  denied: 'Denied',
};

export default async function AdminFinancePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [billingLines, clients, authorizations, evvCredentials] = await Promise.all([
    getBillingLines(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getAllServiceAuthorizations(session.organizationId, session.locationId),
    getEvvCredentials(session.organizationId),
  ]);

  // Compliance gate: once this agency's EVV transmission is 'live', billing
  // lines no longer draft from local clock-out — they wait for the state
  // aggregator to acknowledge the visit (see clockOut in lib/queries.js).
  // That queue needs to be visible here, not just absent from the ledger
  // below, or a completed visit with no billing line looks like a bug
  // instead of a visit correctly waiting on EVV confirmation.
  const evvIsLive = evvCredentials?.status === 'live';
  const awaitingEvv = evvIsLive ? await getVisitsAwaitingEvvConfirmation(session.organizationId, session.locationId) : [];

  const pendingCount = billingLines.filter((b) => b.status === 'pending').length;
  const readyCount = billingLines.filter((b) => b.status === 'ready').length;
  const deniedCount = billingLines.filter((b) => b.status === 'denied').length;
  const unitsThisWeek = billingLines.reduce((sum, b) => sum + b.units, 0);

  // Authorization utilization: units billed (any status except denied) vs.
  // the authorized units/week for each client's active authorization —
  // the same "did we bill what we're approved for" check a biller would
  // do by hand against the payer's authorization notice.
  const utilization = authorizations
    .filter((a) => a.status === 'approved' && a.totalUnitsPerWeek)
    .map((auth) => {
      const billedUnits = billingLines
        .filter((b) => b.clientId === auth.clientId && b.status !== 'denied')
        .reduce((sum, b) => sum + b.units, 0);
      return { auth, billedUnits };
    });

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Finance</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Internal billing ledger — draft claim lines generated from completed, EVV-tracked visits, reviewed here
        before submission to a clearinghouse.
      </p>

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={pendingCount} label="Pending review" accent={pendingCount > 0 ? 'oklch(58% 0.13 55)' : undefined} />
        <StatTile num={readyCount} label="Ready to submit" />
        <StatTile num={deniedCount} label="Denied" accent={deniedCount > 0 ? 'var(--danger)' : undefined} />
        <StatTile num={unitsThisWeek} label="Total units logged" />
        {evvIsLive && (
          <StatTile
            num={awaitingEvv.length}
            label="Awaiting EVV confirmation"
            accent={awaitingEvv.length > 0 ? 'oklch(58% 0.13 55)' : undefined}
          />
        )}
      </div>

      {evvIsLive && awaitingEvv.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
          <div className="px-5 py-3.5 border-b border-[var(--border)]">
            <div className="font-display font-extrabold text-[14.5px]">Awaiting EVV confirmation</div>
            <p className="text-[12.5px] text-[var(--muted)] mt-1">
              Completed visits that haven&rsquo;t generated a billing line yet — EVV is live for this agency, so a
              claim line only drafts once the state aggregator acknowledges the visit, not from clock-out alone.
            </p>
          </div>
          <div className="grid grid-cols-[1.3fr_1.3fr_1fr_1fr_1fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
            <div>Client</div>
            <div>Caregiver</div>
            <div>Service date</div>
            <div>EVV status</div>
            <div>Detail</div>
          </div>
          {awaitingEvv.map((v) => (
            <div
              key={v.id}
              className="grid grid-cols-[1.3fr_1.3fr_1fr_1fr_1fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
            >
              <div className="font-display font-bold text-[14px]">{v.clientName}</div>
              <div>{v.caregiverName || '—'}</div>
              <div>{v.serviceDate}</div>
              <div className="capitalize">{v.syncStatus}</div>
              <div className="text-[12px] text-[var(--danger)]">{v.syncError || ''}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="font-display font-extrabold text-[14.5px] mb-4">Authorization utilization</div>
        {utilization.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            No client has an approved authorization with a units/week figure on file yet — add one from a
            client&rsquo;s Care Plan page.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {utilization.map(({ auth, billedUnits }) => {
              const pct = Math.min(100, Math.round((billedUnits / auth.totalUnitsPerWeek) * 100));
              const over = billedUnits > auth.totalUnitsPerWeek;
              return (
                <div key={auth.id}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1">
                    <Link
                      href={`/admin/clients/${auth.clientId}/care-plan`}
                      className="font-display font-bold text-[var(--accent)]"
                    >
                      {auth.clientName}
                    </Link>
                    <span className={over ? 'text-[var(--danger)] font-display font-bold' : 'text-[var(--muted)]'}>
                      {billedUnits} / {auth.totalUnitsPerWeek} units · {auth.serviceCode}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden">
                    <div
                      className={'h-full rounded-full ' + (over ? 'bg-[var(--danger)]' : 'bg-[var(--accent-strong)]')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.3fr_1fr_0.8fr_1fr_1.3fr_1.4fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Service code</div>
          <div>Units</div>
          <div>Service date</div>
          <div>Source</div>
          <div>Status</div>
        </div>

        {billingLines.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            No billing lines yet — they&rsquo;re generated automatically when a caregiver clocks out of a visit,
            or can be added manually below.
          </div>
        )}

        {billingLines.map((b) => (
          <div
            key={b.id}
            className="grid grid-cols-[1.3fr_1fr_0.8fr_1fr_1.3fr_1.4fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div className="font-display font-bold text-[14px]">{b.clientName}</div>
            <div>{b.serviceCode}</div>
            <div>{b.units}</div>
            <div>{b.serviceDate}</div>
            <div className="text-[12px] text-[var(--muted)]">
              {b.visitId ? 'Auto — completed visit' : 'Manual entry'}
            </div>
            <div>
              <BillingStatusSelect billingLineId={b.id} status={b.status} />
            </div>
          </div>
        ))}
      </div>

      <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
          + Add billing line manually
        </summary>
        <form action={createBillingLineAction} className="grid grid-cols-2 gap-4 mt-5">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Client
            <select name="clientId" required className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Service code
            <input name="serviceCode" required placeholder="S5125" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Units
            <input name="units" type="number" required className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Service date
            <input name="serviceDate" type="date" required className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Notes
            <textarea name="notes" rows={2} className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <div className="col-span-2">
            <button type="submit" className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px]">
              Add billing line
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
