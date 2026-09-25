'use client';

import { useActionState } from 'react';
import { updateSignInSecurityAction } from '@/actions/settings';

export default function SignInSecurityForm({ requireTwoFactor, emailLive }) {
  const [state, action, pending] = useActionState(updateSignInSecurityAction, {});
  return (
    <form action={action} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-5">
      <div className="font-display font-extrabold text-[15px]">Sign-in security</div>
      <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
        Office accounts can see client health information for the whole agency. Requiring a one-time code at sign-in
        means a leaked or guessed password alone isn&rsquo;t enough. Caregivers can turn it on for themselves under
        their account.
      </p>
      {!emailLive && (
        <p className="text-[12.5px] text-[oklch(45%_0.1_75)] mt-2 max-w-[640px]">
          Email isn&rsquo;t connected on this server yet — codes would only be written to the server log. Connect email
          on the Communications page before requiring this.
        </p>
      )}
      <label className="flex items-center gap-2.5 mt-4 text-[13px] font-display font-bold cursor-pointer">
        <input type="checkbox" name="requireTwoFactor" defaultChecked={requireTwoFactor} />
        Require two-step sign-in for admins, location admins and coordinators
      </label>
      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state?.success && <span className="text-[12.5px] text-[var(--success)]">{state.success}</span>}
        {state?.error && <span className="text-[12.5px] text-[var(--danger)]">{state.error}</span>}
      </div>
    </form>
  );
}
