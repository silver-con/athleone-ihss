import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCourses, getCompletionsForCaregiver } from '@/lib/queries';
import CourseCard from '@/components/caregiver/CourseCard';

export default async function CaregiverTrainingPage() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const [courses, completions] = await Promise.all([
    getCourses(session.organizationId),
    getCompletionsForCaregiver(session.organizationId, session.caregiverId),
  ]);

  const doneIds = new Set(completions.map((c) => c.courseId));
  const initial = courses.filter((c) => c.courseType === 'initial');
  const annual = courses.filter((c) => c.courseType === 'annual');
  const initialDone = initial.filter((c) => doneIds.has(c.id)).length;
  const allDone = initial.length > 0 && initialDone === initial.length;
  const pct = initial.length ? Math.round((initialDone / initial.length) * 100) : 0;

  return (
    <div>
      <h2 className="font-display font-extrabold text-[19px]">Training</h2>
      <p className="text-[12.5px] text-[var(--muted)] mt-1">
        Watch each video, then mark it complete. Your progress is saved as you go.
      </p>

      {initial.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 mt-4">
          <div className="flex items-center justify-between text-[12.5px] mb-2">
            <span className="font-display font-bold">
              {allDone ? 'Onboarding training complete' : 'Onboarding progress'}
            </span>
            <span className="text-[var(--muted)]">
              {initialDone} of {initial.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden">
            <div
              className={'h-full rounded-full ' + (allDone ? 'bg-[var(--success)]' : 'bg-[var(--accent-strong)]')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {allDone && (
            <p className="text-[12px] text-[var(--success)] font-display font-bold mt-2">
              All set — the office has been notified.
            </p>
          )}
        </div>
      )}

      {courses.length === 0 && (
        <p className="text-[13px] text-[var(--muted)] mt-6">
          No training assigned yet. The office will add courses here.
        </p>
      )}

      {initial.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-2">
            Onboarding
          </div>
          <div className="flex flex-col gap-3">
            {initial.map((c) => (
              <CourseCard key={c.id} course={c} completed={doneIds.has(c.id)} />
            ))}
          </div>
        </div>
      )}

      {annual.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-2">
            Annual refreshers
          </div>
          <div className="flex flex-col gap-3">
            {annual.map((c) => (
              <CourseCard key={c.id} course={c} completed={doneIds.has(c.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
