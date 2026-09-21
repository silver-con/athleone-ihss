'use client';

import { useActionState } from 'react';
import { createLocationAction } from '@/actions/locations';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function CreateLocationForm() {
  const [state, formAction, pending] = useActionState(createLocationAction, {
    error: null,
    success: null,
  });

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Add location
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2 max-w-[560px]">
        A location shares your agency&rsquo;s license, Medicaid provider number and EVV/e-sign
        credentials — only caregivers, clients and the revenue they generate are scoped to it. Set
        a commission rate if this location is a partner paying your agency out of their revenue.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.error}
        </div>
      )}

      {state?.success && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.success}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass}>
          Location name
          <input name="name" required placeholder="e.g. Houston Metro" className={field} />
        </label>
        <label className={labelClass}>
          Commission rate (%)
          <input
            name="commissionRate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue="0"
            className={field}
          />
        </label>
        <div className="flex items-end col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Adding…' : 'Add location'}
          </button>
        </div>
      </form>
    </details>
  );
}
