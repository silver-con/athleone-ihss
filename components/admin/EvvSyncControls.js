'use client';

import { useState, useTransition } from 'react';
import { runEvvSyncAction, testEvvConnectionAction, retrySyncRowAction } from '@/actions/evv';

export function EvvSyncButtons({ configured }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);

  const run = (fn, describe) =>
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await fn();
        setMessage(describe(result));
      } catch (err) {
        setMessage({ tone: 'bad', text: err.message || 'Something went wrong.' });
      }
    });

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || !configured}
          onClick={() =>
            run(runEvvSyncAction, (r) => {
              if (r.send?.skipped) return { tone: 'bad', text: r.send.reason };
              const s = r.send || {};
              const p = r.poll || {};
              return {
                tone: s.failed || p.failed ? 'warn' : 'good',
                text: `Sent ${s.sent || 0}, acknowledged ${p.acknowledged || 0}, still awaiting ${p.stillPending || 0}, failed ${(s.failed || 0) + (p.failed || 0)}.`,
              };
            })
          }
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Working…' : 'Sync now'}
        </button>

        <button
          type="button"
          disabled={pending || !configured}
          onClick={() =>
            run(testEvvConnectionAction, (r) =>
              r.ok
                ? { tone: 'good', text: 'Connected — credentials accepted.' }
                : { tone: 'bad', text: r.error || 'Connection failed.' }
            )
          }
          className="border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          Test connection
        </button>
      </div>

      {message && (
        <p
          className={
            'text-[12.5px] font-display font-bold mt-2.5 ' +
            (message.tone === 'good'
              ? 'text-[var(--success)]'
              : message.tone === 'warn'
                ? 'text-[oklch(45%_0.11_55)]'
                : 'text-[var(--danger)]')
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

export function RetryButton({ rowId }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => retrySyncRowAction(rowId))}
      className="text-[12px] font-display font-bold text-[var(--accent)] disabled:opacity-60"
    >
      {pending ? '…' : 'Retry'}
    </button>
  );
}
