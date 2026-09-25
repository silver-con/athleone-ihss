'use client';

import { useActionState, useEffect, useRef } from 'react';
import { sendOfficeMessageAction } from '@/actions/messages';

const NOTE = {
  logged: 'recorded (texting/email not connected yet)',
  sent: 'sent',
  failed: 'failed',
  skipped: 'skipped',
};

export default function OfficeMessageComposer({ caregiverId, caregiverName, notifyChannel }) {
  const [state, action, pending] = useActionState(sendOfficeMessageAction.bind(null, caregiverId), {});
  const formRef = useRef(null);
  useEffect(() => {
    if (state?.sent) formRef.current?.reset();
  }, [state?.sent]);

  return (
    <form ref={formRef} action={action} className="border-t border-[var(--border)] p-4">
      <div className="flex gap-2 items-end">
        <textarea
          name="text"
          rows={2}
          maxLength={2000}
          required
          placeholder={`Message ${caregiverName}…`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="flex-1 resize-none border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[13.5px] bg-white outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-4 py-2.5 rounded-xl disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div className="text-[11.5px] text-[var(--muted)] mt-2 min-h-[16px]">
        {state?.error ? (
          <span className="text-[var(--danger)]">{state.error}</span>
        ) : state?.notified?.length ? (
          <>
            Sent.{' '}
            {state.notified.map((n) => `${n.channel === 'sms' ? 'Text' : 'Email'} notice ${NOTE[n.status] || n.status}${n.error ? ` — ${n.error}` : ''}`).join(' · ')}
          </>
        ) : notifyChannel === 'none' ? (
          'Caregivers are not notified — they see it next time they open Hearth. (Change on the Communications page.)'
        ) : (
          `They’ll get a ${notifyChannel === 'both' ? 'text and an email' : notifyChannel === 'email' ? 'an email' : 'text'} saying a message is waiting. Enter sends · Shift+Enter for a new line.`
        )}
      </div>
    </form>
  );
}
