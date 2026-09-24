'use client';

import { useActionState, useState } from 'react';
import { createTeamMemberAction } from '@/actions/team';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function CreateTeamMemberForm({ locations = [] }) {
  const [state, formAction, pending] = useActionState(createTeamMemberAction, {
    error: null,
    success: null,
  });
  // Location is required for a location admin and forbidden for an org
  // admin, so the control follows the chosen role rather than letting
  // someone submit a combination the action will only reject.
  const [role, setRole] = useState('LOCATION_ADMIN');
  const locationRequired = role === 'LOCATION_ADMIN';
  const locationAllowed = role !== 'ADMIN';

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Add someone to the team
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2 max-w-[600px]">
        Creates an office account and the login they use. Give them the starting password
        privately — they&rsquo;ll be required to replace it with their own the first time they sign in. Caregivers are added from the
        Caregivers page instead, so their HR record and credentialing travel with them.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          {state.success}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass}>
          Full name
          <input name="name" required className={field} />
        </label>
        <label className={labelClass}>
          Email (their login)
          <input name="email" type="email" required className={field} />
        </label>
        <label className={labelClass}>
          Starting password
          <input name="password" type="text" required minLength={10} className={field} />
        </label>
        <label className={labelClass}>
          Role
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={field}
          >
            <option value="LOCATION_ADMIN">
              Location admin — runs one location
            </option>
            <option value="COORDINATOR">
              Coordinator — intake and referrals
            </option>
            <option value="ADMIN">
              Organization admin — full access, every location
            </option>
          </select>
        </label>

        <label className={labelClass + ' col-span-2'}>
          Location {locationRequired ? '(required)' : locationAllowed ? '(optional)' : ''}
          <select
            name="locationId"
            className={field}
            required={locationRequired}
            disabled={!locationAllowed}
            defaultValue=""
          >
            <option value="">
              {locationAllowed
                ? 'Organization-wide (every location)'
                : 'Organization-wide — an org admin always sees every location'}
            </option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
          {locations.length === 0 && (
            <span className="text-[11px] font-body font-normal text-[var(--danger)]">
              No locations yet — create one first, or a location admin has nowhere to belong.
            </span>
          )}
        </label>

        <div className="flex items-end col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </details>
  );
}
