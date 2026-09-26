'use client';

import { useActionState, useState } from 'react';
import { updateEvvSettingsAction } from '@/actions/settings';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';

export default function EvvSettingsForm({ organization, stateDays, stateName }) {
  const [state, formAction, pending] = useActionState(updateEvvSettingsAction, {});
  const [flexible, setFlexible] = useState(Boolean(organization.flexibleHoursEnabled));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
        <div className="font-display font-extrabold text-[15px]">Flexible visit hours</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
          When on, caregivers may work their authorized hours at shifted times on the same day (for example a
          6 AM–12 PM visit worked 8 AM–2 PM). A clock-out later than the grace period past the scheduled end
          is flagged as reason code 110 A for office review.
        </p>
        <label className="flex items-center gap-2.5 mt-4 text-[13px] font-display font-bold cursor-pointer">
          <input type="checkbox" name="flexibleHoursEnabled" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} />
          Allow flexible visit hours
        </label>
        <label className="flex flex-col gap-1.5 mt-4 text-[12.5px] font-display font-bold max-w-[260px]">
          Grace period past scheduled end (minutes)
          <input
            name="graceMinutes"
            type="number"
            min={0}
            max={480}
            step={1}
            required
            defaultValue={organization.flexibleHoursGraceMinutes ?? 20}
            className={field}
          />
        </label>
      </section>

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
        <div className="font-display font-extrabold text-[15px]">Visit maintenance deadline</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
          {stateDays
            ? `${stateName} allows ${stateDays} days after the date of service to correct a visit; after that it locks and only the payer can unlock it. You can set a shorter internal deadline so problems are fixed sooner. Leave blank to use the full ${stateDays} days.`
            : 'Your state’s visit maintenance window isn’t configured in Athleone yet.'}
        </p>
        <label className="flex flex-col gap-1.5 mt-4 text-[12.5px] font-display font-bold max-w-[260px]">
          Days after the date of service
          <input
            name="maintenanceWindowDays"
            type="number"
            min={1}
            max={stateDays || 365}
            step={1}
            placeholder={stateDays ? String(stateDays) : ''}
            defaultValue={organization.visitMaintenanceWindowDays ?? ''}
            className={field}
          />
        </label>
      </section>

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
        <div className="font-display font-extrabold text-[15px]">&ldquo;At home&rdquo; radius</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
          When a caregiver clocks in or out as &ldquo;Client&rsquo;s home&rdquo; but their GPS is farther than this from the
          client&rsquo;s home location, the EVV screens highlight the distance for review. Vesta uses 250 feet.
        </p>
        <label className="flex flex-col gap-1.5 mt-4 text-[12.5px] font-display font-bold max-w-[260px]">
          Feet
          <input
            name="homeRadiusFeet"
            type="number"
            min={50}
            max={2000}
            step={1}
            required
            defaultValue={organization.homeRadiusFeet ?? 250}
            className={field}
          />
        </label>
      </section>

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
        <div className="font-display font-extrabold text-[15px]">Overlapping visits</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
          When one caregiver&rsquo;s visits overlap in time and their GPS locations are farther apart than this, the
          visits are held back from export until someone corrects them or records reason code 110 D (allowable
          overlapping visits). Two clients in the same home are never flagged. Vesta uses 100 feet.
        </p>
        <label className="flex flex-col gap-1.5 mt-4 text-[12.5px] font-display font-bold max-w-[260px]">
          Feet
          <input
            name="overlapDistanceFeet"
            type="number"
            min={25}
            max={1000}
            step={1}
            required
            defaultValue={organization.overlapDistanceFeet ?? 100}
            className={field}
          />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {state?.error && <span className="text-[12.5px] font-display font-bold text-[var(--danger)]">{state.error}</span>}
        {state?.success && <span className="text-[12.5px] font-display font-bold text-[var(--success)]">{state.success}</span>}
      </div>
    </form>
  );
}
