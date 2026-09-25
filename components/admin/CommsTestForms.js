'use client';

import { useActionState } from 'react';
import { sendTestEmailAction, sendTestSmsAction } from '@/actions/communications';
import ResultMessage from '@/components/comms/ResultMessage';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white flex-1 min-w-[200px]';
const btn = 'border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60 whitespace-nowrap';

export default function CommsTestForms({ defaultEmail }) {
  const [emailState, emailAction, emailPending] = useActionState(sendTestEmailAction, {});
  const [smsState, smsAction, smsPending] = useActionState(sendTestSmsAction, {});
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
      <div className="font-display font-extrabold text-[15px]">Send a test</div>
      <p className="text-[12.5px] text-[var(--muted)] mt-1">Checks the connection end to end. Test messages appear in the outbox too.</p>
      <form action={emailAction} className="mt-4">
        <div className="flex flex-wrap gap-2">
          <input name="to" type="email" defaultValue={defaultEmail} required className={field} aria-label="Email address" />
          <button type="submit" disabled={emailPending} className={btn}>
            {emailPending ? 'Sending…' : 'Send test email'}
          </button>
        </div>
        <ResultMessage state={emailState} />
      </form>
      <form action={smsAction} className="mt-4">
        <div className="flex flex-wrap gap-2">
          <input name="to" type="tel" placeholder="(512) 555-0147" required className={field} aria-label="Mobile number" />
          <button type="submit" disabled={smsPending} className={btn}>
            {smsPending ? 'Sending…' : 'Send test text'}
          </button>
        </div>
        <ResultMessage state={smsState} />
      </form>
    </section>
  );
}
