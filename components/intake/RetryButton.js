'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryDocumentAction } from '@/actions/intake';

export default function RetryButton({ documentId }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await retryDocumentAction(documentId);
            if (r?.error) setError(r.error);
            router.refresh();
          })
        }
        className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {pending ? 'Reading…' : 'Read it again'}
      </button>
      {error && <span className="text-[12px] text-[var(--danger)]">{error}</span>}
    </span>
  );
}
