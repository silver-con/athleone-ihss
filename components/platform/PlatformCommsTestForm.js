'use client';

import { useActionState } from 'react';
import { platformSendTestAction } from '@/actions/communications';
import ResultMessage from '@/components/comms/ResultMessage';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';

export default function PlatformCommsTestForm({ defaultEmail }) {
  const [state, action, pending] = useActionState(platformSendTestAction, {});
  return (
    <form action={action} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
      <div className="font-display font-extrabold text-[15px]">Send a test</div>
      <div className="flex flex-wrap gap-2 mt-3">
        <select name="channel" className={field} defaultValue="email" aria-label="Channel">
          <option value="email">Email</option>
          <option value="sms">Text</option>
        </select>
        <input name="to" defaultValue={defaultEmail} placeholder="email or mobile number" className={field + ' flex-1 min-w-[220px]'} aria-label="Send to" />
        <button
          type="submit"
          disabled={pending}
          className="border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send test'}
        </button>
      </div>
      <ResultMessage state={state} />
    </form>
  );
}
