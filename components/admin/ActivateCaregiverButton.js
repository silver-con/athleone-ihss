'use client';

import { useTransition } from 'react';
import { activateCaregiverAction } from '@/actions/onboarding';

export default function ActivateCaregiverButton({ caregiverId, ready, blockers }) {
  const [pending, startTransition] = useTransition();

  if (!ready) {
    return (
      <div>
        <button
          type="button"
          disabled
          className="bg-[oklch(93%_0.008_85)] text-[var(--muted)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] cursor-not-allowed"
        >
          Activate caregiver
        </button>
        <p className="text-[12px] text-[var(--muted)] mt-2">
          Still outstanding: {blockers.join(', ')}.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => activateCaregiverAction(caregiverId))}
      className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
    >
      {pending ? 'Activating…' : 'Activate caregiver'}
    </button>
  );
}
