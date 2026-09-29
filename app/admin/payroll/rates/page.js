// Attendant pay rates: each attendant's default hourly rate, and optional
// different rates for particular clients. Entered by the agency — Athleone
// never guesses a rate. ADMIN only (pay is HR information).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregivers, getClients, getPayRates } from '@/lib/queries';
import { money, FEDERAL_MINIMUM_WAGE } from '@/lib/payroll-pay';
import { DefaultRateForm, ClientRateForm, RemoveRateButton } from '@/components/admin/PayrollForms';

export default async function PayRatesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [caregivers, clients, rates] = await Promise.all([
    getCaregivers(session.organizationId),
    getClients(session.organizationId),
    getPayRates(session.organizationId),
  ]);
  const payable = caregivers.filter((c) => c.status !== 'inactive' && c.status !== 'applicant');
  const byId = (list, id) => list.find((x) => x.id === id);
  const defaults = new Map(rates.filter((r) => !r.clientId).map((r) => [r.caregiverId, r]));
  const clientRates = rates.filter((r) => r.clientId);
  const missing = payable.filter((c) => !defaults.has(c.id)).length;

  return (
    <div className="max-w-[900px]">
      <Link href="/admin/payroll" className="text-[12.5px] font-display font-bold text-[var(--accent)]">← Payroll Hours</Link>
      <h1 className="font-display font-extrabold text-[24px] mt-2">Pay rates</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[720px]">
        Each attendant&rsquo;s hourly rate. A client rate, if set, is used for visits with that client instead of the
        default. Rates below the minimum wage (${FEDERAL_MINIMUM_WAGE.toFixed(2)}/hr) aren&rsquo;t accepted. Every change is in
        the Audit Log. Approved pay periods keep the rates they were approved with.
      </p>

      {missing > 0 && (
        <div className="bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-3 mt-4 text-[13px] text-[oklch(38%_0.09_75)]">
          <strong className="font-display">{missing} attendant(s) have no default rate.</strong> Their visits can&rsquo;t be paid or approved until one is set.
        </div>
      )}

      <section className="mt-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <h2 className="font-display font-extrabold text-[15px] px-5 py-3 border-b border-[var(--border)]">Default rates</h2>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11.5px] text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-5 py-2 font-semibold">Attendant</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-5 py-2 font-semibold">Default hourly rate</th>
            </tr>
          </thead>
          <tbody>
            {payable.map((c) => {
              const r = defaults.get(c.id);
              return (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="font-display font-bold">{c.name}</div>
                    <div className="text-[11.5px] text-[var(--muted)]">{c.role}</div>
                  </td>
                  <td className="px-2 py-2.5 capitalize text-[var(--muted)]">{c.status}</td>
                  <td className="px-5 py-2.5">
                    <DefaultRateForm caregiverId={c.id} currentRate={r ? (r.rateCents / 100).toFixed(2) : ''} />
                    {r?.updatedBy && <div className="text-[11px] text-[var(--muted)] mt-0.5">Last set by {r.updatedBy}</div>}
                  </td>
                </tr>
              );
            })}
            {payable.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-4 text-[var(--muted)]">No active attendants yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <h2 className="font-display font-extrabold text-[15px] px-5 py-3 border-b border-[var(--border)]">Rates for particular clients</h2>
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <ClientRateForm
            caregivers={payable.map((c) => ({ id: c.id, name: c.name }))}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
        {clientRates.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-[var(--muted)]">None — every visit uses the attendant&rsquo;s default rate.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {clientRates.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-5 py-2.5 font-display font-bold">{byId(caregivers, r.caregiverId)?.name || r.caregiverId}</td>
                  <td className="px-2 py-2.5">with {byId(clients, r.clientId)?.name || r.clientId}</td>
                  <td className="px-2 py-2.5">{money(r.rateCents)}/hr</td>
                  <td className="px-5 py-2.5 text-right"><RemoveRateButton rateId={r.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
