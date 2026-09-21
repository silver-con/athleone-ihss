import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCourses, getCaregivers, getAllCompletions } from '@/lib/queries';
import StatTile from '@/components/StatTile';
import { createCourseAction } from '@/actions/training';

const inputClass =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';

export default async function AdminTrainingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [courses, caregivers, completions] = await Promise.all([
    getCourses(session.organizationId),
    getCaregivers(session.organizationId, session.locationId),
    getAllCompletions(session.organizationId, session.locationId),
  ]);

  const initialCourses = courses.filter((c) => c.courseType === 'initial');
  const totalHoursDelivered = completions.reduce((sum, c) => sum + c.hoursCredited, 0);
  const fullyTrained = caregivers.filter((cg) => {
    if (initialCourses.length === 0) return false;
    const done = completions.filter((c) => c.caregiverId === cg.id).map((c) => c.courseId);
    return initialCourses.every((c) => done.includes(c.id));
  }).length;

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Training</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Course library and completion across the roster. Caregivers watch and complete courses in their own
        app — hours are credited at the time of completion.
      </p>

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={courses.length} label="Active courses" />
        <StatTile num={`${fullyTrained} / ${caregivers.length}`} label="Caregivers fully onboarded" />
        <StatTile num={totalHoursDelivered.toFixed(1)} label="Training hours recorded" />
      </div>

      {/* Completion matrix */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 overflow-x-auto">
        <div className="font-display font-extrabold text-[14.5px] mb-4">Completion by caregiver</div>
        {courses.length === 0 || caregivers.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Add a course below to start tracking completion.
          </p>
        ) : (
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)]">
                <th className="text-left pb-2 pr-4">Caregiver</th>
                {courses.map((c) => (
                  <th key={c.id} className="text-left pb-2 pr-4 font-display max-w-[150px]">
                    {c.title}
                  </th>
                ))}
                <th className="text-left pb-2">Hours</th>
              </tr>
            </thead>
            <tbody>
              {caregivers.map((cg) => {
                const mine = completions.filter((c) => c.caregiverId === cg.id);
                const hrs = mine.reduce((s, c) => s + c.hoursCredited, 0);
                return (
                  <tr key={cg.id} className="border-t border-[oklch(94%_0.008_85)]">
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/admin/caregivers/${cg.id}`}
                        className="font-display font-bold text-[var(--accent)]"
                      >
                        {cg.name}
                      </Link>
                    </td>
                    {courses.map((c) => {
                      const done = mine.some((m) => m.courseId === c.id);
                      return (
                        <td key={c.id} className="py-2.5 pr-4">
                          <span className={done ? 'text-[var(--success)]' : 'text-[oklch(80%_0.01_85)]'}>
                            {done ? '✓' : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2.5 font-display font-bold">{hrs.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Course library */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-4">
        <div className="grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1.4fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Course</div>
          <div>Type</div>
          <div>Hours</div>
          <div>Length</div>
          <div>Video</div>
        </div>
        {courses.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">No courses yet.</div>
        )}
        {courses.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1.4fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div>
              <div className="font-display font-bold text-[14px]">{c.title}</div>
              {c.description && (
                <div className="text-[12px] text-[var(--muted)] mt-0.5">{c.description}</div>
              )}
            </div>
            <div>{c.courseType === 'annual' ? 'Annual' : 'Onboarding'}</div>
            <div>{c.hours}</div>
            <div>{c.durationMinutes ? `${c.durationMinutes} min` : '—'}</div>
            <div className="text-[12px] text-[var(--muted)] truncate">
              {c.videoUrl ? (
                <a href={c.videoUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] font-display font-bold">
                  Open link
                </a>
              ) : (
                'No link set'
              )}
            </div>
          </div>
        ))}
      </div>

      <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">+ Add course</summary>
        <form action={createCourseAction} className="grid grid-cols-2 gap-4 mt-5">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Title
            <input name="title" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Description
            <input name="description" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Video URL
            <input
              name="videoUrl"
              placeholder="https://… (unlisted YouTube or Vimeo link works)"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Type
            <select name="courseType" defaultValue="initial" className={inputClass}>
              <option value="initial">Onboarding (initial)</option>
              <option value="annual">Annual refresher</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Credited hours
            <input name="hours" type="number" step="0.25" defaultValue="0.5" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Video length (minutes)
            <input name="durationMinutes" type="number" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Sort order
            <input name="sortOrder" type="number" defaultValue="0" className={inputClass} />
          </label>
          <div className="col-span-2">
            <button
              type="submit"
              className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px]"
            >
              Add course
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
