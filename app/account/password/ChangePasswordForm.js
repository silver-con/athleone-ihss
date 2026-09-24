'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '@/actions/account';

const field =
  'border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';
const label = 'text-[12.5px] font-display font-bold text-[var(--muted)]';

export default function ChangePasswordForm({ minLength }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className={label}>Current password</label>
        <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className={field} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className={label}>New password</label>
        <input id="newPassword" name="newPassword" type="password" required minLength={minLength} autoComplete="new-password" className={field} />
        <span className="text-[11.5px] text-[var(--muted)]">
          At least {minLength} characters. A short phrase is easier to remember than a jumble.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className={label}>Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" required minLength={minLength} autoComplete="new-password" className={field} />
      </div>

      {state?.error && (
        <div className="text-[13px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 bg-[var(--accent-strong)] text-white font-display font-bold text-[14px] rounded-xl py-2.5 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
