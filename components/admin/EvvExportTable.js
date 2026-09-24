'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { holdVisitsAction, releaseVisitsAction, queueVisitsAction } from '@/actions/evv-export';

const TONE = {
  danger: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]',
  warning: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  neutral: 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]',
};
const btn = 'font-display font-bold text-[12px] px-3 py-1.5 rounded-[9px] disabled:opacity-50';

function Result({ state }) {
  if (state?.error) return <span className="text-[12px] font-display font-bold text-[var(--danger)]">{state.error}</span>;
  if (state?.success) return <span className="text-[12px] font-display font-bold text-[var(--success)]">{state.success}</span>;
  return null;
}

// Rows come from the server page as plain objects:
// { id, dateLabel, clientName, caregiverName, stateKey, stateLabel, tone, detail, fixHref }
export default function EvvExportTable({ rows, canQueueStates }) {
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState('');
  const [holdState, holdAction, holdPending] = useActionState(holdVisitsAction, {});
  const [releaseState, releaseAction, releasePending] = useActionState(releaseVisitsAction, {});
  const [queueState, queueAction, queuePending] = useActionState(queueVisitsAction, {});
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const hidden = selected.map((id) => <input key={id} type="hidden" name="visitIds" value={id} />);
  const queueable = rows.filter((r) => canQueueStates.includes(r.stateKey)).map((r) => r.id);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3 mt-4">
        <span className="text-[12.5px] font-display font-bold">{selected.length} selected</span>
        <form action={queueAction}>
          {hidden}
          <button type="submit" disabled={queuePending || selected.length === 0} className={btn + ' bg-[var(--accent-strong)] text-white'}>
            {queuePending ? 'Queueing…' : 'Queue to send'}
          </button>
        </form>
        <form action={holdAction} className="flex items-end gap-2">
          {hidden}
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Reason for hold"
            className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12.5px] w-[200px] bg-white"
          />
          <button type="submit" disabled={holdPending || selected.length === 0} className={btn + ' border border-[var(--border)] bg-white'}>
            {holdPending ? 'Holding…' : 'Hold'}
          </button>
        </form>
        <form action={releaseAction}>
          {hidden}
          <button type="submit" disabled={releasePending || selected.length === 0} className={btn + ' border border-[var(--border)] bg-white'}>
            {releasePending ? 'Releasing…' : 'Release hold'}
          </button>
        </form>
        {queueable.length > 0 && (
          <button type="button" onClick={() => setSelected(queueable)} className="text-[12px] font-display font-bold text-[var(--accent)] underline">
            Select all ready to queue ({queueable.length})
          </button>
        )}
        <div className="basis-full flex flex-wrap gap-3">
          <Result state={queueState} />
          <Result state={holdState} />
          <Result state={releaseState} />
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-4">
        <div className="grid grid-cols-[36px_0.9fr_1.2fr_1.1fr_1.3fr_2fr] px-4 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)] items-center">
          <input
            type="checkbox"
            aria-label="Select all"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}
          />
          <div>Date</div>
          <div>Client</div>
          <div>Caregiver</div>
          <div>Export state</div>
          <div>Why / next step</div>
        </div>
        {rows.length === 0 && <div className="px-5 py-6 text-[13px] text-[var(--muted)]">No closed visits match.</div>}
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[36px_0.9fr_1.2fr_1.1fr_1.3fr_2fr] px-4 py-3 text-[13px] items-start border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <input type="checkbox" aria-label={`Select ${r.clientName} ${r.dateLabel}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="mt-1" />
            <div className="text-[12.5px]">{r.dateLabel}</div>
            <Link href={r.fixHref} className="font-display font-bold hover:text-[var(--accent)]">{r.clientName}</Link>
            <div className="text-[12.5px]">{r.caregiverName || '—'}</div>
            <div>
              <span className={'inline-block text-[11px] font-display font-bold px-2.5 py-1 rounded-full ' + (TONE[r.tone] || TONE.neutral)}>
                {r.stateLabel}
              </span>
            </div>
            <div className="text-[12px] text-[var(--muted)] leading-snug">
              {r.detail || '—'}
              {r.stateKey === 'needs_maintenance' && (
                <Link href={r.fixHref} className="ml-1.5 font-display font-bold text-[var(--danger)]">Fix &amp; verify →</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
