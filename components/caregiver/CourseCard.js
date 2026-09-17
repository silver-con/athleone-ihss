'use client';

import { useState, useTransition } from 'react';
import { markCourseCompleteAction } from '@/actions/training';

export default function CourseCard({ course, completed }) {
  const [pending, startTransition] = useTransition();
  const [opened, setOpened] = useState(false);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display font-extrabold text-[14.5px]">{course.title}</div>
          <div className="text-[12px] text-[var(--muted)] mt-0.5">
            {course.durationMinutes ? `${course.durationMinutes} min · ` : ''}
            {course.hours} hrs credit
            {course.courseType === 'annual' ? ' · annual' : ''}
          </div>
        </div>
        {completed && (
          <span className="text-[10.5px] font-display font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[var(--success-soft)] text-[var(--success)] shrink-0">
            Done
          </span>
        )}
      </div>

      {course.description && (
        <p className="text-[12.5px] text-[var(--muted)] mt-2">{course.description}</p>
      )}

      {!completed && (
        <div className="flex items-center gap-2 mt-3">
          {course.videoUrl && (
            <a
              href={course.videoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpened(true)}
              className="flex-1 text-center border border-[var(--border)] rounded-[10px] px-3 py-2 text-[12.5px] font-display font-bold"
            >
              Watch video
            </a>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => markCourseCompleteAction(course.id))}
            className="flex-1 bg-[var(--accent-strong)] text-white rounded-[10px] px-3 py-2 text-[12.5px] font-display font-bold disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Mark complete'}
          </button>
        </div>
      )}

      {!completed && opened && (
        <p className="text-[11.5px] text-[var(--muted)] mt-2">
          Opened in a new tab — come back and mark it complete when you&rsquo;ve finished.
        </p>
      )}
    </div>
  );
}
