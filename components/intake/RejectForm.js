'use client';

// Reject a document that can't be reviewed (couldn't be read, or reading was
// interrupted) — e.g. a junk fax or one meant for another agency.
import { useActionState } from 'react';
import { rejectDocumentAction } from '@/actions/intake';

export default function RejectForm({ documentId }) {
  const [state, reject, rejecting] = useActionState(rejectDocumentAction.bind(null, documentId), {});
  return (
    <form action={reject} className="mt-3 flex flex-wrap items-center gap-2">
      <input name="reason" placeholder="Or reject it — why? e.g. not a referral, wrong agency" className="flex-1 min-w-[220px] border border-[var(--border)] rounded-lg px-3 py-2 text-[12.5px] bg-white" />
      <button type="submit" disabled={rejecting} className="border border-[var(--danger)] text-[var(--danger)] font-display font-bold text-[12px] px-3 py-2 rounded-lg">
        {rejecting ? 'Rejecting…' : 'Reject'}
      </button>
      {state?.error && <span className="text-[12px] text-[var(--danger)]">{state.error}</span>}
    </form>
  );
}
