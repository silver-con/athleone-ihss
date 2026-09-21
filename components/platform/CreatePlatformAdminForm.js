'use client';

import { useActionState } from 'react';
import { createPlatformAdminAction } from '@/actions/platform';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function CreatePlatformAdminForm() {
  const [state, formAction, pending] = useActionState(createPlatformAdminAction, {
    error: null,
    success: null,
  });

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Add platform admin
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2 max-w-[560px]">
        Grants someone the same cross-tenant access you have — every agency&rsquo;s go-live status
        and EVV health, and the ability to onboard new agencies. Give them the starting password
        yourself, out of band; they can change it after they sign in.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.error}
        </div>
      )}

      {state?.success && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          Created &ldquo;{state.success.name}&rdquo; — login is {state.success.email}, role{' '}
          {state.success.platformRole === 'full' ? 'Full admin' : 'Support'}. Pass them the password
          you just set.
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass + ' col-span-2'}>
          Full name
          <input name="name" required className={field} />
        </label>
        <label className={labelClass}>
          Email (their login)
          <input name="email" type="email" required className={field} />
        </label>
        <label className={labelClass}>
          Starting password
          <input name="password" type="text" required minLength={8} className={field} />
        </label>
        <label className={labelClass + ' col-span-2'}>
          Role
          <select name="platformRole" defaultValue="support" className={field}>
            <option value="support">Support — can view every agency and the platform team, can&rsquo;t onboard an agency or manage the team</option>
            <option value="full">Full admin — everything Support can do, plus onboarding a new agency and adding/deactivating platform admins</option>
          </select>
        </label>
        <div className="flex items-end col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create platform admin'}
          </button>
        </div>
      </form>
    </details>
  );
}
