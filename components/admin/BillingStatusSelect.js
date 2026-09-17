'use client';

import { useTransition } from 'react';
import { updateBillingLineStatusAction } from '@/actions/billing';

const STATUS_COLORS = {
  pending: 'border-[oklch(75%_0.1_55)] text-[oklch(45%_0.11_55)]',
  ready: 'border-[var(--accent-strong)] text-[var(--accent)]',
  submitted: 'border-[oklch(70%_0.1_250)] text-[oklch(45%_0.12_250)]',
  paid: 'border-[var(--success)] text-[var(--success)]',
  denied: 'border-[var(--danger)] text-[var(--danger)]',
};

export default function BillingStatusSelect({ billingLineId, status }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => startTransition(() => updateBillingLineStatusAction(billingLineId, e.target.value))}
      className={
        'border rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-display font-semibold bg-[oklch(99%_0.004_85)] disabled:opacity-60 ' +
        (STATUS_COLORS[status] || 'border-[oklch(85%_0.01_85)]')
      }
    >
      <option value="pending">Pending review</option>
      <option value="ready">Ready to submit</option>
      <option value="submitted">Submitted</option>
      <option value="paid">Paid</option>
      <option value="denied">Denied</option>
    </select>
  );
}
