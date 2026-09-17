import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClient, getVisitsForCaregiver } from '@/lib/queries';
import { WEEK_DAYS, careNeedOptions } from '@/lib/data';
import { visitStatusInfo } from '@/lib/styles';

export default async function CaregiverClientProfilePage({ params }) {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const { id } = await params;
  const client = await getClient(session.organizationId, id);

  if (!client) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Client not found. <Link href="/caregiver/clients" className="text-[var(--accent)] font-display font-bold">Back to clients</Link>
      </div>
    );
  }

  const myVisits = await getVisitsForCaregiver(session.organizationId, session.caregiverId);
  const history = myVisits
    .filter((v) => v.clientId === client.id && v.status !== 'scheduled')
    .slice()
    .sort((a, b) => WEEK_DAYS.findIndex((d) => d.key === a.day) - WEEK_DAYS.findIndex((d) => d.key === b.day));

  const careNeeds = (client.careNeeds || [])
    .map((tid) => careNeedOptions.find((o) => o.id === tid)?.label)
    .filter(Boolean);

  return (
    <div>
      <Link
        href="/caregiver/clients"
        className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] mb-3"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </Link>

      <div className="font-display font-extrabold text-[19px]">{client.name}</div>
      <div className="text-[12.5px] text-[var(--muted)] mt-0.5">{client.payer} · {client.authHours}</div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-4 mt-4 flex flex-col gap-2.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <span className="text-[var(--muted)] shrink-0">Address</span>
          <span className="font-display font-semibold text-right">{client.address}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-[var(--muted)] shrink-0">Emergency contact</span>
          <span className="font-display font-semibold text-right">{client.emergencyContact}</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="font-display font-extrabold text-[12.5px] uppercase tracking-wide text-[var(--muted)] mb-2.5">
          Care needs
        </div>
        <div className="flex flex-wrap gap-1.5">
          {careNeeds.map((label) => (
            <span
              key={label}
              className="text-[12px] font-display font-semibold bg-[var(--accent-soft)] text-[var(--accent)] px-2.5 py-1 rounded-full"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="font-display font-extrabold text-[12.5px] uppercase tracking-wide text-[var(--muted)] mb-2.5">
          Visit history
        </div>
        {history.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No visits recorded yet this week.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((v) => {
              const info = visitStatusInfo(v.status);
              const day = WEEK_DAYS.find((d) => d.key === v.day);
              return (
                <Link
                  key={v.id}
                  href={`/caregiver/visit/${v.id}`}
                  className="flex items-center justify-between gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-[12px] px-3.5 py-3"
                >
                  <div>
                    <div className="font-display font-bold text-[13px]">{day?.label} {day?.date}</div>
                    <div className="text-[11.5px] text-[var(--muted)] mt-0.5">{v.start}–{v.end}</div>
                  </div>
                  <span className={'inline-flex items-center gap-1.5 text-[10.5px] font-display font-bold px-2.5 py-1 rounded-full ' + info.className}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.dot }} />
                    {info.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
