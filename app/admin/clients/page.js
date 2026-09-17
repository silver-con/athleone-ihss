import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClients, getCaregivers } from '@/lib/queries';
import CaregiverAssignSelect from '@/components/admin/CaregiverAssignSelect';

export default async function AdminClientsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [clients, caregivers] = await Promise.all([
    getClients(session.organizationId),
    getCaregivers(session.organizationId),
  ]);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Clients</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Agency-wide active clients with completed intake — assign or reassign caregivers
      </p>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.5fr_1.2fr_1fr_1.1fr_1.4fr_1fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Payer</div>
          <div>Hours / week</div>
          <div>Intake completed</div>
          <div>Assigned caregiver</div>
          <div></div>
        </div>

        {clients.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1.5fr_1.2fr_1fr_1.1fr_1.4fr_1fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div className="font-display font-bold text-[14.5px]">{c.name}</div>
            <div>{c.payer}</div>
            <div>{c.authHours}</div>
            <div>{c.intakeDate}</div>
            <div>
              <CaregiverAssignSelect
                clientId={c.id}
                assignedCaregiverId={c.assignedCaregiverId}
                caregivers={caregivers}
              />
            </div>
            <div>
              <Link
                href={`/admin/clients/${c.id}/care-plan`}
                className="text-[12.5px] font-display font-bold text-[var(--accent)] whitespace-nowrap"
              >
                Care plan →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
