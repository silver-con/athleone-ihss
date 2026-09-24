'use client';

import { useActionState } from 'react';
import { resetCaregiverPasswordAction } from '@/actions/team';

// "Reset sign-in password" on a caregiver's record. The temporary password
// is shown once, here, for the office to pass on; the caregiver must set
// their own at next sign-in.
export default function CaregiverPasswordReset({ caregiverId }) {
  const [state, formAction, pending] = useActionState(resetCaregiverPasswordAction, {});
  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="caregiverId" value={caregiverId} />
      <button
        type="submit"
        disabled={pending}
        className="border border-[var(--border)] bg-white font-display font-bold text-[12px] px-3 py-1.5 rounded-[9px] disabled:opacity-60"
      >
        {pending ? 'Resetting…' : 'Reset sign-in password'}
      </button>
      {state?.error && <div className="text-[12px] font-display font-bold text-[var(--danger)] max-w-[320px] text-right">{state.error}</div>}
      {state?.success && <div className="text-[12px] font-display font-bold text-[var(--success)] max-w-[320px] text-right">{state.success}</div>}
      {state?.temporaryPassword && (
        <div className="font-mono text-[15px] tracking-wide bg-white border border-[var(--border)] rounded-lg px-3 py-2 select-all">
          {state.temporaryPassword}
        </div>
      )}
    </form>
  );
}
