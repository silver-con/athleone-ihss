'use client';

import { useTransition } from 'react';
import { togglePlatformAdminActiveAction } from '@/actions/platform';

// Same convention as components/admin/CaregiverStatusToggle.js: a plain
// button wired to a Server Action via useTransition, no confirmation
// dialog (the action is reversible — click again to flip it back).
export default function PlatformAdminStatusToggle({ platformAdminId, active }) {
  const [pending, startTransition] = useTransition();

  const toneClass = active
    ? 'bg-[var(--success-soft)] text-[var(--success)]'
    : 'bg-[var(--danger-soft)] text-[var(--danger)]';

  return (
    <button
      onClick={() => startTransition(() => togglePlatformAdminActiveAction(platformAdminId, !active))}
      disabled={pending}
      className={
        'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap cursor-pointer disabled:opacity-60 ' +
        toneClass
      }
      title="Click to toggle status"
    >
      {pending ? '…' : active ? 'Active' : 'Inactive'}
    </button>
  );
}
