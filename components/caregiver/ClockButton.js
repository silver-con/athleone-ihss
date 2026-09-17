'use client';

import { useTransition } from 'react';
import { clockInAction, clockOutAction } from '@/actions/caregiver';

export function ClockInButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => clockInAction(visitId))}
      disabled={pending}
      className={className}
    >
      {pending ? 'Clocking in…' : children || 'Clock In'}
    </button>
  );
}

export function ClockOutButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => clockOutAction(visitId))}
      disabled={pending}
      className={className}
    >
      {pending ? 'Clocking out…' : children || 'Clock Out'}
    </button>
  );
}
