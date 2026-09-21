import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClients } from '@/lib/queries';
import Toast from '@/components/Toast';

export default async function ClientsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const clients = await getClients(session.organizationId, session.locationId);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Clients</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Active IHSS clients with completed intake
      </p>

      <Suspense fallback={null}>
        <Toast />
      </Suspense>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.6fr_1.2fr_1fr_1.2fr_1fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Payer</div>
          <div>Hours / week</div>
          <div>Intake completed</div>
          <div>Status</div>
        </div>
        {clients.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1.6fr_1.2fr_1fr_1.2fr_1fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div className="font-display font-bold text-[14.5px]">{c.name}</div>
            <div>{c.payer}</div>
            <div>{c.authHours}</div>
            <div>{c.intakeDate}</div>
            <div>
              <span className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                Active
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
