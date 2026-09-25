'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { verifyCodeAction, resendCodeAction, cancelSignInAction } from '@/actions/auth';
import { inputClass, primaryButton, labelClass, ErrorBox, InfoBox } from '@/components/auth/AuthShell';

export default function VerifyCodeForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, {});
  const [resendState, resend, resending] = useActionState(resendCodeAction, {});
  const restart = state?.restart || resendState?.restart;

  if (restart) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorBox>{state?.error || resendState?.error}</ErrorBox>
        <Link href="/login" className={primaryButton + ' text-center'}>
          Sign in again
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className={labelClass}>
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            className={inputClass + ' text-center tracking-[0.35em] text-[20px] font-display font-bold'}
          />
        </div>
        <ErrorBox>{state?.error}</ErrorBox>
        <InfoBox>{resendState?.info}</InfoBox>
        <ErrorBox>{resendState?.error}</ErrorBox>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? 'Checking…' : 'Verify and sign in'}
        </button>
      </form>
      <div className="flex items-center justify-between text-[12.5px]">
        <form action={resend}>
          <button type="submit" disabled={resending} className="font-display font-bold text-[var(--accent)] disabled:opacity-60">
            {resending ? 'Sending…' : 'Send a new code'}
          </button>
        </form>
        <form action={cancelSignInAction}>
          <button type="submit" className="font-display font-bold text-[var(--muted)]">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
