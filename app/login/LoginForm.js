'use client';

import { useActionState } from 'react';
import { loginAction } from '@/actions/auth';

const initialState = { error: null };

export default function LoginForm({ next, prefill }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next || ''} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={prefill?.email || ''}
          autoComplete="email"
          className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="you@hearthcare.example"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          defaultValue={prefill?.password || ''}
          autoComplete="current-password"
          className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="••••••••"
        />
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
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
