'use client';

import { useActionState } from 'react';
import { signupAction } from '@/actions/signup';
import { US_STATES } from '@/lib/data';

const initialState = { error: null };

export default function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="organizationName" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
          Agency name
        </label>
        <input
          id="organizationName"
          name="organizationName"
          type="text"
          required
          className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Sunrise Home Care"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="adminName" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
            Your name
          </label>
          <input
            id="adminName"
            name="adminName"
            type="text"
            required
            className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Jordan Reyes"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="you@agency.example"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="At least 8 characters"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Repeat password"
          />
        </div>
      </div>

      <details className="border border-[var(--border)] rounded-xl px-3.5 py-2.5">
        <summary className="text-[12.5px] font-display font-bold text-[var(--muted)] cursor-pointer">
          Provider info (optional &mdash; can add later)
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="state" className="text-[11.5px] font-display font-bold text-[var(--muted)]">
              State
            </label>
            <select
              id="state"
              name="state"
              defaultValue="TX"
              className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="medicaidProviderNumber" className="text-[11.5px] font-display font-bold text-[var(--muted)]">
              Medicaid provider #
            </label>
            <input
              id="medicaidProviderNumber"
              name="medicaidProviderNumber"
              type="text"
              className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="npi" className="text-[11.5px] font-display font-bold text-[var(--muted)]">
              NPI
            </label>
            <input
              id="npi"
              name="npi"
              type="text"
              className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="stateLicenseNumber" className="text-[11.5px] font-display font-bold text-[var(--muted)]">
              State home-care license #
            </label>
            <input
              id="stateLicenseNumber"
              name="stateLicenseNumber"
              type="text"
              className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </details>

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
        {pending ? 'Setting up…' : 'Create your agency’s account'}
      </button>
    </form>
  );
}
