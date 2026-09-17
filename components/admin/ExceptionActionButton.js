'use client';

import { useTransition } from 'react';
import { resolveVisitExceptionAction, submitVMURAction } from '@/actions/admin';

export default function ExceptionActionButton({ visitId, variant = 'review' }) {
  const [pending, startTransition] = useTransition();

  if (variant === 'vmur') {
    return (
      <button
        onClick={() => startTransition(() => submitVMURAction(visitId))}
        disabled={pending}
        className="text-[11.5px] font-display font-bold px-2.5 py-1.5 rounded-full bg-[var(--danger)] text-white cursor-pointer whitespace-nowrap disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Submit VMUR'}
      </button>
    );
  }

  return (
    <button
      onClick={() => startTransition(() => resolveVisitExceptionAction(visitId))}
      disabled={pending}
      className="text-[11.5px] font-display font-bold px-2.5 py-1 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] cursor-pointer whitespace-nowrap disabled:opacity-60"
    >
      {pending ? 'Marking…' : 'Mark reviewed'}
    </button>
  );
}
