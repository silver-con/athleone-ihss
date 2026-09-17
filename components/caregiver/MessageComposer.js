'use client';

import { useRef, useTransition } from 'react';
import { sendMessageAction } from '@/actions/caregiver';

export default function MessageComposer() {
  const formRef = useRef(null);
  const [pending, startTransition] = useTransition();

  function action(formData) {
    if (!String(formData.get('text') || '').trim()) return;
    startTransition(async () => {
      await sendMessageAction(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={action} className="flex items-center gap-2 mt-4 sticky bottom-0 bg-[var(--bg)] pt-2">
      <input
        name="text"
        placeholder="Message the office…"
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        className="flex-1 border border-[var(--border)] rounded-full px-4 py-2.5 text-[13px] bg-[var(--surface)] outline-none focus:border-[var(--accent)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 w-[38px] h-[38px] rounded-full bg-[var(--accent-strong)] text-white flex items-center justify-center cursor-pointer disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
