'use client';

import { useActionState, useState } from 'react';
import { performVisitMaintenanceAction } from '@/actions/admin';

const CONTACTS = [
  { value: 'client', label: 'Client (or their representative)' },
  { value: 'caregiver', label: 'Caregiver who worked the visit' },
  { value: 'substitute', label: 'Substitute / fill-in caregiver' },
  { value: 'none', label: 'No contact needed' },
];

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';
const stepTitle = 'font-display font-extrabold text-[13.5px] flex items-center gap-2';
const stepNum =
  'w-[22px] h-[22px] rounded-full bg-[var(--accent-strong)] text-white text-[11.5px] flex items-center justify-center shrink-0';

// Contact -> document -> verify, on one form (Vesta's three steps, HHSC's
// rules). The server re-checks everything; this only guides the user.
export default function VisitMaintenanceForm({ visitId, reasonGroups, initialCodes = [], needsClockIn, needsClockOut, isMissed, currentBillMinutes = null }) {
  const [state, formAction, pending] = useActionState(performVisitMaintenanceAction, {});
  const [codes, setCodes] = useState(initialCodes);
  const allCodes = reasonGroups.flatMap((g) => g.codes);
  const chosen = allCodes.filter((c) => codes.includes(c.code));
  const noteRequired = chosen.some((c) => c.requiresNote);
  const noteHints = chosen.filter((c) => c.noteHint).map((c) => c.noteHint);
  const manualAllowed = chosen.some((c) => c.allowsManualTime);
  const timesNeeded = !isMissed && (needsClockIn || needsClockOut);
  const lowersBill = codes.includes('110B');

  function toggle(code) {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code].slice(-3)));
  }

  if (state?.success) {
    return (
      <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-4 py-3 text-[13px] font-display font-bold">
        {state.success}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="visitId" value={visitId} />

      <section>
        <div className={stepTitle}><span className={stepNum}>1</span>Contact</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-2.5">Who did you contact to confirm what happened and that services were delivered?</p>
        <div className="flex flex-wrap gap-2">
          {CONTACTS.map((c) => (
            <label key={c.value} className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] cursor-pointer has-[:checked]:border-[var(--accent-strong)] has-[:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="contact" value={c.value} required />
              {c.label}
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className={stepTitle}><span className={stepNum}>2</span>Document</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-2.5">
          Pick the HHSC reason code(s) that explain the exception — up to three.
        </p>
        <div className="border border-[var(--border)] rounded-xl max-h-[320px] overflow-y-auto bg-white">
          {reasonGroups.map((g) => (
            <div key={g.group}>
              <div className="px-3.5 py-2 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] bg-[oklch(97%_0.005_85)] border-b border-[var(--border)] sticky top-0">
                {g.label}
              </div>
              {g.codes.map((c) => (
                <label key={c.code} className="flex items-start gap-2.5 px-3.5 py-2 text-[13px] border-b border-[oklch(95%_0.01_85)] cursor-pointer hover:bg-[oklch(98.5%_0.004_85)]">
                  <input
                    type="checkbox"
                    name="reasonCodes"
                    value={c.code}
                    checked={codes.includes(c.code)}
                    onChange={() => toggle(c.code)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-display font-bold">{c.code.length > 3 ? `${c.code.slice(0, 3)} ${c.code.slice(3)}` : c.code}</span>{' '}
                    {c.label.split(' — ').slice(1).join(' — ') || c.label}
                    {c.requiresNote && <span className="ml-1.5 text-[11px] font-display font-bold text-[oklch(45%_0.1_75)]">note required</span>}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {timesNeeded && (
          <div className="mt-4 grid grid-cols-2 gap-4 max-w-[440px]">
            {needsClockIn && (
              <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
                Time services started
                <input type="time" name="manualClockIn" required disabled={!manualAllowed} className={field} />
              </label>
            )}
            {needsClockOut && (
              <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
                Time services ended
                <input type="time" name="manualClockOut" required disabled={!manualAllowed} className={field} />
              </label>
            )}
            <p className="col-span-2 text-[11.5px] text-[var(--muted)]">
              {manualAllowed
                ? 'Only the missing time can be entered. Recorded clock times and GPS can’t be changed (HHSC EVV Policy Handbook §9000).'
                : 'Choose a 210 reason code (No Electronic Clock In or Clock Out) to enter a missing time.'}
            </p>
          </div>
        )}

        {lowersBill && (
          <div className="mt-4">
            <div className="text-[12.5px] font-display font-bold">Billable time after the adjustment</div>
            <div className="flex items-center gap-2 mt-1.5">
              <input name="billHours" type="number" min={0} max={24} step={1} required placeholder="h" className={field + ' w-[80px]'} />
              <span className="text-[12.5px] text-[var(--muted)]">h</span>
              <input name="billMinutes" type="number" min={0} max={59} step={1} placeholder="m" className={field + ' w-[80px]'} />
              <span className="text-[12.5px] text-[var(--muted)]">m</span>
            </div>
            <p className="text-[11.5px] text-[var(--muted)] mt-1.5">
              {currentBillMinutes
                ? `Currently ${Math.floor(currentBillMinutes / 60)}h ${currentBillMinutes % 60}m. 110 B can only lower it; a draft billing line is recalculated automatically.`
                : '110 B can only lower billable time.'}
            </p>
          </div>
        )}

        <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold mt-4">
          Note {noteRequired ? '(required)' : '(optional)'}
          <textarea
            name="note"
            rows={3}
            maxLength={1000}
            required={noteRequired}
            placeholder={noteHints[0] || 'What happened, and how it was confirmed.'}
            className={field}
          />
        </label>
      </section>

      <section>
        <div className={stepTitle}><span className={stepNum}>3</span>Verify</div>
        <label className="flex items-start gap-2.5 mt-2.5 text-[13px] cursor-pointer">
          <input type="checkbox" name="verified" required className="mt-0.5" />
          <span>I confirmed the services were delivered as documented above. My name and the time are recorded with this correction.</span>
        </label>
      </section>

      {state?.error && (
        <div className="text-[13px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5">
          {state.error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={pending || codes.length === 0}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save and verify visit'}
        </button>
      </div>
    </form>
  );
}
