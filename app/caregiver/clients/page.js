import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClients } from '@/lib/queries';

export default async function CaregiverClientsPage() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const clients = await getClients(session.organizationId);
  const myClients = clients.filter((c) => c.assignedCaregiverId === session.caregiverId);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[19px]">My Clients</h1>
      <p className="text-[12.5px] text-[var(--muted)] mt-0.5 mb-4">
        {myClients.length} client{myClients.length === 1 ? '' : 's'} on your caseload
      </p>

      {myClients.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">No clients assigned yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {myClients.map((c) => (
            <Link
              key={c.id}
              href={`/caregiver/clients/${c.id}`}
              className="block bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3.5"
            >
              <div className="font-display font-extrabold text-[14.5px]">{c.name}</div>
              <div className="text-[12px] text-[var(--muted)] mt-0.5">
                {c.authHours} · {c.address}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
