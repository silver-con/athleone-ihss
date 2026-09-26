'use client';

import { useTransition, useState } from 'react';
import { loadSampleFaxAction } from '@/actions/intake';

export default function SampleFaxButtons({ samples }) {
  const [pending, start] = useTransition();
  const [which, setWhich] = useState(null);
  const [error, setError] = useState(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-[var(--muted)]">Try a sample fax:</span>
      {Object.entries(samples).map(([key, s]) => (
        <button
          key={key}
          type="button"
          disabled={pending}
          onClick={() => {
            setWhich(key);
            setError(null);
            start(async () => {
              const r = await loadSampleFaxAction(key);
              if (r?.error) setError(r.error);
            });
          }}
          className="border border-[var(--border)] bg-white font-display font-bold text-[12px] px-3 py-1.5 rounded-lg disabled:opacity-60"
        >
          {pending && which === key ? 'Reading…' : s.label}
        </button>
      ))}
      {error && <span className="text-[12px] text-[var(--danger)]">{error}</span>}
    </div>
  );
}
