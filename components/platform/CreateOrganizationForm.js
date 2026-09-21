'use client';

import { useActionState } from 'react';
import { createOrganizationAction } from '@/actions/platform';
import { US_STATES } from '@/lib/data';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, {
    error: null,
    success: null,
  });

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Onboard a new agency
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2 max-w-[560px]">
        Creates the agency&rsquo;s account and its first admin login directly — the same thing
        their own self-service signup does, done here on their behalf. Give the agency the
        starting password yourself, out of band; they can change it after they sign in. Provider
        info is optional here — the agency can fill it in themselves on their go-live checklist.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.error}
        </div>
      )}

      {state?.success && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          Created &ldquo;{state.success.organizationName}&rdquo; — admin login is{' '}
          {state.success.email}. Pass {state.success.adminName} the password you just set.
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass + ' col-span-2'}>
          Agency name
          <input name="organizationName" required className={field} />
        </label>
        <label className={labelClass}>
          Admin&rsquo;s name
          <input name="adminName" required className={field} />
        </label>
        <label className={labelClass}>
          Admin&rsquo;s email (their login)
          <input name="email" type="email" required className={field} />
        </label>
        <label className={labelClass}>
          Starting password
          <input name="password" type="text" required minLength={8} className={field} />
        </label>
        <label className={labelClass}>
          State
          <select name="state" defaultValue="TX" className={field}>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Medicaid provider number (optional)
          <input name="medicaidProviderNumber" className={field} />
        </label>
        <label className={labelClass}>
          NPI (optional)
          <input name="npi" className={field} />
        </label>
        <label className={labelClass}>
          State license number (optional)
          <input name="stateLicenseNumber" className={field} />
        </label>
        <div className="flex items-end col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create agency'}
          </button>
        </div>
      </form>
    </details>
  );
}
