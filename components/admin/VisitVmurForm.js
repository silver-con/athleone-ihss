'use client';

import { useActionState } from 'react';
import { recordVisitVmurAction } from '@/actions/admin';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';

// Past the maintenance window: the visit is locked and only the payer can
// unlock it. This records that the agency sent a Visit Maintenance Unlock
// Request, with its justification, for the audit trail.
export default function VisitVmurForm({ visitId }) {
  const [state, formAction, pending] = useActionState(recordVisitVmurAction, {});
  if (state?.success) {
    return (
      <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-4 py-3 text-[13px] font-display font-bold">
        {state.success}
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-[620px]">
      <input type="hidden" name="visitId" value={visitId} />
      <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
        Why does this visit need to be unlocked?
        <textarea name="justification" rows={3} required minLength={10} maxLength={1000} className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold max-w-[320px]">
        Payer reference / ticket number (optional)
        <input name="payerReference" maxLength={100} className={field} />
      </label>
      {state?.error && <div className="text-[13px] font-display font-bold text-[var(--danger)]">{state.error}</div>}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--danger)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Record VMUR sent to payer'}
        </button>
      </div>
    </form>
  );
}
