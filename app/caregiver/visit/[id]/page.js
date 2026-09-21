import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getVisit, getClient, getOrganization } from '@/lib/queries';
import { WEEK_DAYS } from '@/lib/data';
import { getComplianceProfile } from '@/lib/state-compliance';
import { visitStatusInfo } from '@/lib/styles';
import { ClockInButton, ClockOutButton } from '@/components/caregiver/ClockButton';
import TaskCheckbox from '@/components/caregiver/TaskCheckbox';
import BackButton from './BackButton';

export default async function VisitDetailPage({ params }) {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const { id } = await params;
  const visit = await getVisit(session.organizationId, id);

  if (!visit || visit.caregiverId !== session.caregiverId) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Visit not found. <Link href="/caregiver/schedule" className="text-[var(--accent)] font-display font-bold">Back to schedule</Link>
      </div>
    );
  }

  const [client, organization] = await Promise.all([
    getClient(session.organizationId, visit.clientId),
    getOrganization(session.organizationId),
  ]);
  const reasonCodes = getComplianceProfile(organization?.state)?.reasonCodes || {};
  const info = visitStatusInfo(visit.status);
  const day = WEEK_DAYS.find((d) => d.key === visit.day);
  const canEditTasks = visit.status === 'in-progress' || visit.status === 'completed';

  return (
    <div>
      <BackButton />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display font-extrabold text-[19px]">{client?.name}</div>
          <div className="text-[12.5px] text-[var(--muted)] mt-0.5">
            {day?.label} {day?.date} · {visit.start}–{visit.end}
          </div>
        </div>
        <span className={'shrink-0 inline-flex items-center gap-1.5 text-[10.5px] font-display font-bold px-2.5 py-1 rounded-full ' + info.className}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.dot }} />
          {info.label}
        </span>
      </div>

      <Link
        href={`/caregiver/clients/${client?.id}`}
        className="inline-block text-[12px] font-display font-bold text-[var(--accent)] mt-2"
      >
        View client profile →
      </Link>

      {/* EVV clock in/out */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-4 mt-4">
        <div className="font-display font-extrabold text-[12.5px] uppercase tracking-wide text-[var(--muted)] mb-3">
          Visit check-in (EVV)
        </div>

        {visit.status === 'scheduled' && (
          <ClockInButton
            visitId={visit.id}
            className="w-full bg-[var(--accent-strong)] text-white font-display font-bold text-[13.5px] rounded-[10px] py-3 cursor-pointer disabled:opacity-60"
          />
        )}

        {visit.status === 'in-progress' && (
          <>
            <div className="flex justify-between text-[13px] mb-3">
              <span className="text-[var(--muted)]">Clocked in</span>
              <span className="font-display font-bold">{visit.evv?.clockIn}</span>
            </div>
            <ClockOutButton
              visitId={visit.id}
              className="w-full bg-[var(--success)] text-white font-display font-bold text-[13.5px] rounded-[10px] py-3 cursor-pointer disabled:opacity-60"
            />
          </>
        )}

        {(visit.status === 'completed' || visit.status === 'missed') && visit.evv && (
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Clock-in</span>
              <span className="font-display font-bold">{visit.evv.clockIn || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Clock-out</span>
              <span className="font-display font-bold">{visit.evv.clockOut || '—'}</span>
            </div>
            {visit.evv.exception && (
              <div className="mt-1 bg-[var(--danger-soft)] text-[var(--danger)] rounded-[10px] px-3 py-2.5 text-[12.5px] font-display font-semibold">
                Code {visit.evv.exception} — {reasonCodes[visit.evv.exception]?.label || 'Unknown reason code'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Care plan checklist */}
      <div className="mt-4">
        <div className="font-display font-extrabold text-[12.5px] uppercase tracking-wide text-[var(--muted)] mb-2.5">
          Care plan checklist
        </div>
        {!canEditTasks && (
          <p className="text-[12.5px] text-[var(--muted)] mb-2.5">
            {visit.status === 'scheduled'
              ? 'Checklist unlocks once you clock in.'
              : 'This visit was missed — no tasks were recorded.'}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {visit.tasks?.map((task) => (
            <TaskCheckbox key={task.id} visitId={visit.id} task={task} disabled={!canEditTasks} />
          ))}
        </div>
      </div>
    </div>
  );
}
