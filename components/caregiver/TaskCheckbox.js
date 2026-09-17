'use client';

import { useTransition } from 'react';
import { toggleVisitTaskAction } from '@/actions/caregiver';

export default function TaskCheckbox({ visitId, task, disabled }) {
  const [pending, startTransition] = useTransition();

  return (
    <label
      className={
        'flex items-center gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-[12px] px-3.5 py-3 ' +
        (disabled ? 'opacity-60' : 'cursor-pointer')
      }
    >
      <input
        type="checkbox"
        checked={task.done}
        disabled={disabled || pending}
        onChange={() => startTransition(() => toggleVisitTaskAction(visitId, task.id))}
        className="w-[18px] h-[18px] accent-[var(--accent-strong)] shrink-0"
      />
      <span
        className={
          'text-[13.5px] font-display font-semibold ' +
          (task.done ? 'line-through text-[var(--muted)]' : '')
        }
      >
        {task.label}
      </span>
    </label>
  );
}
