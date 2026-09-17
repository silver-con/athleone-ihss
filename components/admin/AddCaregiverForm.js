'use client';

import { useActionState } from 'react';
import { addCaregiverAction } from '@/actions/onboarding';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function AddCaregiverForm() {
  const [state, formAction, pending] = useActionState(addCaregiverAction, { error: null });

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Add caregiver
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2">
        Creates an applicant and the login they use to complete onboarding. Give them the starting
        password directly — they can change it later.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.error}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass}>
          Full name
          <input name="name" required className={field} />
        </label>
        <label className={labelClass}>
          Role
          <select name="role" defaultValue="Home Care Aide" className={field}>
            <option>Home Care Aide</option>
            <option>Personal Care Attendant</option>
            <option>Certified Nursing Assistant</option>
            <option>Registered Nurse</option>
          </select>
        </label>
        <label className={labelClass}>
          Phone
          <input name="phone" className={field} />
        </label>
        <label className={labelClass}>
          Email (their login)
          <input name="email" type="email" required className={field} />
        </label>
        <label className={labelClass}>
          Starting password
          <input name="password" type="text" required minLength={8} className={field} />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] w-full disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create applicant'}
          </button>
        </div>
      </form>
    </details>
  );
}
