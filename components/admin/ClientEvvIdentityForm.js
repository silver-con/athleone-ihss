'use client';

import { useActionState } from 'react';
import { updateClientEvvIdentityAction } from '@/actions/care-plans';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';
const hint = 'text-[11px] font-body font-normal text-[var(--muted)]';

// The member identity the state EVV aggregator needs. Without a valid
// Medicaid ID, this client's visits are held back from transmission (see
// validateVisitPayload in lib/evv-mapping.js).
export default function ClientEvvIdentityForm({ client }) {
  const [state, formAction, pending] = useActionState(updateClientEvvIdentityAction, {
    error: null,
    success: null,
  });

  return (
    <form action={formAction} className="grid grid-cols-4 gap-4 mt-4 items-start">
      <input type="hidden" name="clientId" value={client.id} />

      <label className={labelClass + ' col-span-2'}>
        Medicaid ID
        <input
          name="medicaidId"
          inputMode="numeric"
          autoComplete="off"
          placeholder="9 digits"
          defaultValue={client.medicaidId || ''}
          className={field}
        />
        <span className={hint}>Texas Medicaid ID from the member&rsquo;s card or the payer authorization.</span>
      </label>

      <label className={labelClass + ' col-span-2'}>
        Date of birth
        <input name="dateOfBirth" type="date" defaultValue={client.dateOfBirth || ''} className={field} />
      </label>

      <label className={labelClass + ' col-span-4'}>
        Street address (where services are delivered)
        <input name="addressLine1" defaultValue={client.addressLine1 || ''} className={field} />
      </label>

      <label className={labelClass + ' col-span-2'}>
        City
        <input name="city" defaultValue={client.city || ''} className={field} />
      </label>
      <label className={labelClass}>
        State
        <input name="state" maxLength={2} placeholder="TX" defaultValue={client.state || ''} className={field + ' uppercase'} />
      </label>
      <label className={labelClass}>
        ZIP
        <input name="zip" inputMode="numeric" placeholder="78550" defaultValue={client.zip || ''} className={field} />
      </label>

      <div className="col-span-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save EVV identity'}
        </button>
        {state?.error && (
          <span className="text-[12.5px] font-display font-bold text-[var(--danger)]">{state.error}</span>
        )}
        {state?.success && (
          <span className="text-[12.5px] font-display font-bold text-[var(--success)]">{state.success}</span>
        )}
      </div>
    </form>
  );
}
