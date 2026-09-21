import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClients, getCaregivers, getLocations } from '@/lib/queries';
import CaregiverAssignSelect from '@/components/admin/CaregiverAssignSelect';
import LocationAssignSelect from '@/components/admin/LocationAssignSelect';

export default async function AdminClientsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [clients, caregivers, locations] = await Promise.all([
    getClients(session.organizationId, session.locationId),
    getCaregivers(session.organizationId, session.locationId),
    getLocations(session.organizationId),
  ]);

  const canReassign = session.role === 'ADMIN';
  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Clients</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Agency-wide active clients with completed intake — assign or reassign caregivers
      </p>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1fr_1.3fr_0.9fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Payer</div>
          <div>Location</div>
          <div>Hours / week</div>
          <div>Intake completed</div>
          <div>Assigned caregiver</div>
          <div></div>
        </div>

        {clients.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1fr_1.3fr_0.9fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div className="font-display font-bold text-[14.5px]">{c.name}</div>
            <div>{c.payer}</div>
            <div className="pr-2">
              {canReassign ? (
                <LocationAssignSelect
                  kind="client"
                  recordId={c.id}
                  locationId={c.locationId}
                  locations={locations}
                />
              ) : (
                <span className="text-[12.5px] text-[var(--muted)]">
                  {locationById[c.locationId]?.name || 'No location'}
                </span>
              )}
            </div>
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
