'use client';

import { useActionState } from 'react';
import { updateLocationAction } from '@/actions/locations';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function EditLocationForm({ location }) {
  const [state, formAction, pending] = useActionState(updateLocationAction, {
    error: null,
    success: null,
  });

  return (
    <details className="mt-2">
      <summary className="text-[12px] font-display font-bold text-[var(--accent)] cursor-pointer">
        Configure
      </summary>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-lg px-3 py-2 text-[12px] font-display font-bold mt-2">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-lg px-3 py-2 text-[12px] font-display font-bold mt-2">
          {state.success}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-3 mt-3 items-end">
        <input type="hidden" name="locationId" value={location.id} />
        <label className={labelClass}>
          Name
          <input name="name" required defaultValue={location.name} className={field} />
        </label>
        <label className={labelClass}>
          Status
          <select name="status" defaultValue={location.status} className={field}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <div className="col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </details>
  );
}
