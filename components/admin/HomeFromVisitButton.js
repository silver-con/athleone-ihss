'use client';

import { useActionState } from 'react';
import { setClientHomeFromVisitAction } from '@/actions/care-plans';

// "Use this as the client's home" for one clock event's GPS fix — Vesta's
// "Learned Location" adjustment, done by office staff.
export default function HomeFromVisitButton({ visitId, which }) {
  const [state, formAction, pending] = useActionState(setClientHomeFromVisitAction, {});
  if (state?.success) {
    return <span className="text-[11px] font-display font-bold text-[var(--success)]">Saved as home ✓</span>;
  }
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="which" value={which} />
      <button type="submit" disabled={pending} className="text-[11px] font-display font-bold text-[var(--accent)] underline disabled:opacity-60">
        {pending ? 'Saving…' : "Use as client's home"}
      </button>
      {state?.error && <span className="ml-1.5 text-[11px] text-[var(--danger)]">{state.error}</span>}
    </form>
  );
}
