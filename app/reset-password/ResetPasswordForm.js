'use client';

import { useActionState } from 'react';
import { resetPasswordAction } from '@/actions/password-reset';
import { inputClass, primaryButton, labelClass, ErrorBox } from '@/components/auth/AuthShell';

export default function ResetPasswordForm({ token, minLength }) {
  const [state, action, pending] = useActionState(resetPasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className={labelClass}>
          New password
        </label>
        <input id="newPassword" name="newPassword" type="password" required minLength={minLength} autoComplete="new-password" className={inputClass} />
        <span className="text-[12px] text-[var(--muted)]">At least {minLength} characters. A short phrase is easiest to remember.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className={labelClass}>
          Type it again
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" required minLength={minLength} autoComplete="new-password" className={inputClass} />
      </div>
      <ErrorBox>{state?.error}</ErrorBox>
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
