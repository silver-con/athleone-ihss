'use client';

import { useTransition } from 'react';
import { assignCaregiverAction } from '@/actions/admin';

export default function CaregiverAssignSelect({ clientId, assignedCaregiverId, caregivers }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={assignedCaregiverId || ''}
      disabled={pending}
      onChange={(e) => startTransition(() => assignCaregiverAction(clientId, e.target.value))}
      className={
        'border rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-display font-semibold bg-[oklch(99%_0.004_85)] disabled:opacity-60 ' +
        (assignedCaregiverId
          ? 'border-[oklch(85%_0.01_85)]'
          : 'border-[oklch(75%_0.1_55)] text-[oklch(45%_0.11_55)]')
      }
    >
      <option value="">Unassigned</option>
      {caregivers.map((cg) => (
        <option key={cg.id} value={cg.id}>
          {cg.name}
        </option>
      ))}
    </select>
  );
}
