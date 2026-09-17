'use client';

import { useState, useTransition } from 'react';
import { testDocusignConnectionAction } from '@/actions/docusign';

export default function DocusignTestButton({ configured }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);

  const run = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await testDocusignConnectionAction();
        setMessage(
          r.ok
            ? { tone: 'good', text: `Connected — account "${r.accountName || r.accountId}".` }
            : {
                tone: 'bad',
                text: r.consentRequired
                  ? r.error
                  : r.error || 'Connection failed.',
              }
        );
      } catch (err) {
        setMessage({ tone: 'bad', text: err.message || 'Something went wrong.' });
      }
    });

  return (
    <div>
      <button
        type="button"
        disabled={pending || !configured}
        onClick={run}
        className="border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
      >
        {pending ? 'Testing…' : 'Test connection'}
      </button>
      {message && (
        <p
          className={
            'text-[12.5px] font-display font-medium mt-2.5 whitespace-pre-wrap break-words max-w-[560px] ' +
            (message.tone === 'good' ? 'text-[var(--success)]' : 'text-[var(--danger)]')
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
