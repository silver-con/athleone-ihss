'use client';

import { useActionState } from 'react';
import {
  savePayRateAction,
  deletePayRateAction,
  approvePayrollPeriodAction,
  reopenPayrollPeriodAction,
} from '@/actions/payroll';

// Client forms for payroll (actions/payroll.js). The server recomputes and
// re-checks everything; these only collect input and show the result.

function Result({ state }) {
  if (state?.error) return <div className="text-[12px] font-display font-bold text-[var(--danger)]">{state.error}</div>;
  if (state?.success) return <div className="text-[12px] font-display font-bold text-[var(--success)]">{state.success}</div>;
  return null;
}

const input = 'border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white text-[13px]';
const button = 'font-display font-bold text-[12.5px] rounded-[9px] px-3 py-1.5 disabled:opacity-60';

// An attendant's default rate (clientId empty) — inline in the rates table.
export function DefaultRateForm({ caregiverId, currentRate }) {
  const [state, action, pending] = useActionState(savePayRateAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="caregiverId" value={caregiverId} />
      <span className="text-[13px]">$</span>
      <input
        name="rate"
        inputMode="decimal"
        defaultValue={currentRate || ''}
        placeholder="0.00"
        aria-label="Default hourly rate"
        className={`${input} w-[90px]`}
        required
      />
      <span className="text-[12px] text-[var(--muted)]">/hr</span>
      <button disabled={pending} className={`${button} border border-[var(--border)] bg-white`}>{pending ? 'Saving…' : 'Save'}</button>
      <Result state={state} />
    </form>
  );
}

// A different rate for one client.
export function ClientRateForm({ caregivers, clients }) {
  const [state, action, pending] = useActionState(savePayRateAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <select name="caregiverId" required className={input} defaultValue="">
        <option value="" disabled>Attendant…</option>
        {caregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select name="clientId" required className={input} defaultValue="">
        <option value="" disabled>Client…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <span className="text-[13px]">$</span>
      <input name="rate" inputMode="decimal" placeholder="0.00" aria-label="Hourly rate for this client" className={`${input} w-[90px]`} required />
      <span className="text-[12px] text-[var(--muted)]">/hr</span>
      <button disabled={pending} className={`${button} bg-[var(--accent-strong)] text-white`}>{pending ? 'Saving…' : 'Add client rate'}</button>
      <Result state={state} />
    </form>
  );
}

export function RemoveRateButton({ rateId }) {
  const [state, action, pending] = useActionState(deletePayRateAction, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="rateId" value={rateId} />
      <button disabled={pending} className="text-[12px] font-display font-bold text-[var(--danger)] disabled:opacity-60">{pending ? 'Removing…' : 'Remove'}</button>
      <Result state={state} />
    </form>
  );
}

export function ApprovePeriodForm({ freq, periodFrom, grossCents, grossLabel, blockers }) {
  const [state, action, pending] = useActionState(approvePayrollPeriodAction, {});
  const blocked = blockers.length > 0;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="freq" value={freq} />
      <input type="hidden" name="period" value={periodFrom} />
      <input type="hidden" name="grossCents" value={grossCents == null ? '' : String(grossCents)} />
      {blocked ? (
        <ul className="list-disc ml-5 text-[12.5px]">
          {blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      ) : (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" name="confirm" required className="mt-0.5" />
          <span>I checked the hours and rates. Lock this pay period at <strong>{grossLabel}</strong> gross pay.</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending || blocked} className={`${button} bg-[var(--accent-strong)] text-white px-4 py-2`}>
          {pending ? 'Approving…' : 'Approve and lock pay period'}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function ReopenPeriodForm({ periodId }) {
  const [state, action, pending] = useActionState(reopenPayrollPeriodAction, {});
  return (
    <details className="text-[12.5px]">
      <summary className="cursor-pointer font-display font-bold text-[var(--danger)]">Reopen this pay period</summary>
      <form action={action} className="flex flex-wrap items-center gap-2 mt-2">
        <input type="hidden" name="periodId" value={periodId} />
        <input name="reason" required minLength={5} maxLength={500} placeholder="Why? e.g. a visit was corrected" className={`${input} w-[320px]`} />
        <button disabled={pending} className={`${button} border border-[var(--border)] bg-white`}>{pending ? 'Reopening…' : 'Reopen'}</button>
        <Result state={state} />
      </form>
    </details>
  );
}
