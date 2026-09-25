import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getVisitsForCaregiver, getClients } from '@/lib/queries';
import { todayIso, addDays, shortDayLabel } from '@/lib/calendar';
import { visitStatusInfo } from '@/lib/styles';
import { ClockInButton } from '@/components/caregiver/ClockButton';

export default async function CaregiverSchedulePage() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const [myVisits, clients] = await Promise.all([
    getVisitsForCaregiver(session.organizationId, session.caregiverId),
    getClients(session.organizationId),
  ]);

  // Real calendar (2026-09-24): today in the agency's time zone, then the
  // next seven days. Visits are matched on their actual date.
  const today = todayIso();
  const todayVisits = myVisits.filter((v) => v.serviceDate === today);
  const upcomingDays = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(today, i + 1);
    return { key: iso, iso, heading: shortDayLabel(iso) };
  });

  return (
    <div>
      <h1 className="font-display font-extrabold text-[19px]">My Schedule</h1>
      <p className="text-[12.5px] text-[var(--muted)] mt-0.5">
        {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · next 7 days
      </p>

      <div className="mt-4">
        <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--accent)] mb-2">
          Today
        </div>
        {todayVisits.length === 0 ? (
          <div className="text-[13px] text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-4">
            No visits scheduled for today.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {todayVisits.map((v) => (
              <VisitCard key={v.id} visit={v} clients={clients} highlight />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-2">
          Upcoming
        </div>
        <div className="flex flex-col gap-2.5">
          {upcomingDays.map((d) => {
            const dayVisits = myVisits.filter((v) => v.serviceDate === d.iso);
            if (dayVisits.length === 0) return null;
            return (
              <div key={d.key}>
                <div className="text-[11.5px] font-display font-bold text-[var(--muted)] mb-1.5">
                  {d.heading}
                </div>
                <div className="flex flex-col gap-2">
                  {dayVisits.map((v) => (
                    <VisitCard key={v.id} visit={v} clients={clients} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VisitCard({ visit, clients, highlight }) {
  const client = clients.find((c) => c.id === visit.clientId);
  const info = visitStatusInfo(visit.status);
  const doneCount = visit.tasks?.filter((t) => t.done).length || 0;

  return (
    <div
      className={
        'bg-[var(--surface)] border rounded-2xl px-4 py-3.5 ' +
        (highlight ? 'border-[var(--accent)]' : 'border-[var(--border)]')
      }
    >
      <Link href={`/caregiver/visit/${visit.id}`} className="block">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[14.5px] truncate">{client?.name}</div>
            <div className="text-[12px] text-[var(--muted)] mt-0.5">
              {visit.start}–{visit.end}
              {visit.tasks && ` · ${doneCount}/${visit.tasks.length} tasks`}
            </div>
          </div>
          <span className={'shrink-0 inline-flex items-center gap-1.5 text-[10.5px] font-display font-bold px-2 py-1 rounded-full ' + info.className}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.dot }} />
            {info.label}
          </span>
        </div>
      </Link>

      {highlight && visit.status === 'scheduled' && (
        <ClockInButton
          visitId={visit.id}
          className="mt-3 w-full bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] rounded-[10px] py-2.5 cursor-pointer disabled:opacity-60"
        />
      )}
      {highlight && visit.status === 'in-progress' && (
        <Link
          href={`/caregiver/visit/${visit.id}`}
          className="mt-3 block text-center w-full bg-[var(--accent-soft)] text-[var(--accent)] font-display font-bold text-[13px] rounded-[10px] py-2.5"
        >
          Visit in progress — open checklist
        </Link>
      )}
    </div>
  );
}
