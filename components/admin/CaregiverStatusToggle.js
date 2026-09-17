'use client';

import { useTransition } from 'react';
import { toggleCaregiverStatusAction } from '@/actions/admin';
import { caregiverStatusInfo } from '@/lib/styles';

export default function CaregiverStatusToggle({ caregiverId, status }) {
  const [pending, startTransition] = useTransition();
  const info = caregiverStatusInfo(status);

  return (
    <button
      onClick={() => startTransition(() => toggleCaregiverStatusAction(caregiverId))}
      disabled={pending}
      className={'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap cursor-pointer disabled:opacity-60 ' + info.className}
      title="Click to toggle status"
    >
      {pending ? '…' : info.label}
    </button>
  );
}
