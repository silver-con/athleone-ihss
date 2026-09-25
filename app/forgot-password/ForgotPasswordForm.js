'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordResetAction } from '@/actions/password-reset';
import { inputClass, primaryButton, labelClass, ErrorBox, InfoBox } from '@/components/auth/AuthShell';

export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, {});
  if (state?.done) {
    return (
      <div className="flex flex-col gap-4">
        <InfoBox>{state.message}</InfoBox>
        <Link href="/login" className="text-center text-[13px] font-display font-bold text-[var(--accent)]">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <ErrorBox>{state?.error}</ErrorBox>
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Sending…' : 'Email me a reset link'}
      </button>
    </form>
  );
}
