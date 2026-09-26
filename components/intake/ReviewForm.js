'use client';

import { useActionState, useMemo, useState } from 'react';
import { approveDocumentAction, rejectDocumentAction } from '@/actions/intake';
import { FIELDS } from '@/lib/docai/fields';
import { validateFields, LOW_CONFIDENCE } from '@/lib/docai/validate';

const GROUPS = [
  ['Client', ['clientName', 'dob', 'medicaidId', 'phone', 'address']],
  ['Payer & authorization', ['payer', 'authStatus', 'authNumber', 'caseId', 'service', 'serviceCode', 'modifier', 'authHours', 'unitsPerWeek', 'totalUnits', 'authStart', 'authEnd', 'reviewDate']],
  ['Clinical & care plan', ['diagnosis', 'diagnosisCode', 'approvedTasks', 'pcpName', 'pcpPhone']],
  ['Payer service coordinator', ['coordinatorName', 'coordinatorPhone', 'coordinatorEmail']],
];
const WIDE = new Set(['diagnosis', 'address', 'approvedTasks', 'service']);

function ConfidenceDot({ field }) {
  if (!field?.value) return <span className="text-[10.5px] text-[var(--muted)]">not found</span>;
  if (field.source === 'reviewer') return <span className="text-[10.5px] text-[var(--muted)]">edited</span>;
  const c = field.confidence ?? 0;
  const low = c < LOW_CONFIDENCE;
  return (
    <span className="text-[10.5px] font-display font-bold" style={{ color: low ? 'oklch(50% 0.13 55)' : 'oklch(42% 0.1 150)' }}>
      {low ? 'check' : 'read'} · {Math.round(c * 100)}%{field.page ? ` · p${field.page}` : ''}
    </span>
  );
}

export default function ReviewForm({ documentId, initialFields, duplicates, readOnly }) {
  const [fields, setFields] = useState(initialFields);
  const [approveState, approve, approving] = useActionState(approveDocumentAction.bind(null, documentId), {});
  const [rejectState, reject, rejecting] = useActionState(rejectDocumentAction.bind(null, documentId), {});
  const [showReject, setShowReject] = useState(false);
  const issues = useMemo(() => validateFields(fields), [fields]);
  const errorCount = Object.values(issues).flat().filter((i) => i.level === 'error').length;

  const set = (key, value) => setFields((f) => ({ ...f, [key]: { ...(f[key] || {}), value, source: 'reviewer' } }));

  return (
    <div className="flex flex-col gap-4">
      {(duplicates.clients.length > 0 || duplicates.referrals.length > 0) && (
        <div className="rounded-2xl border border-[oklch(86%_0.06_85)] bg-[oklch(95%_0.05_85)] px-4 py-3 text-[12.5px]">
          <div className="font-display font-extrabold text-[oklch(42%_0.1_75)]">Possible duplicate</div>
          <ul className="mt-1 list-disc pl-5 text-[oklch(35%_0.05_75)]">
            {duplicates.clients.map((c) => (
              <li key={c.id}>
                Existing client <a className="underline" href={`/admin/clients/${c.id}/care-plan`}>{c.name}</a>
                {c.sameMedicaidId ? ' (same Medicaid ID)' : ' (same name and DOB)'} — this may be a new authorization for them.
              </li>
            ))}
            {duplicates.referrals.map((r) => (
              <li key={r.id}>
                Existing referral <a className="underline" href={`/referrals/${r.id}`}>{r.clientName}</a> ({r.status})
                {r.sameAuthNumber ? ' with the same authorization number' : ''}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={approve} className="flex flex-col gap-4">
        {GROUPS.map(([title, keys]) => (
          <section key={title} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
            <div className="font-display font-extrabold text-[13.5px] mb-3">{title}</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {keys.map((key) => {
                const def = FIELDS.find((f) => f.key === key);
                const list = issues[key] || [];
                const hasError = list.some((i) => i.level === 'error');
                const hasWarn = list.some((i) => i.level === 'warn');
                return (
                  <label key={key} className={'flex flex-col gap-1 ' + (WIDE.has(key) ? 'sm:col-span-2' : '')}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-display font-bold text-[var(--muted)]">
                        {def.label}
                        {def.required && <span className="text-[var(--danger)]"> *</span>}
                      </span>
                      <ConfidenceDot field={fields[key]} />
                    </span>
                    {(() => {
                      const cls =
                        'border rounded-lg px-3 py-2 text-[13px] bg-white ' +
                        (hasError ? 'border-[var(--danger)]' : hasWarn ? 'border-[oklch(75%_0.12_75)] bg-[oklch(98%_0.03_85)]' : 'border-[var(--border)]');
                      return key === 'approvedTasks' ? (
                        <textarea name={key} rows={3} value={fields[key]?.value || ''} onChange={(e) => set(key, e.target.value)} readOnly={readOnly} className={cls} />
                      ) : (
                        <input name={key} value={fields[key]?.value || ''} onChange={(e) => set(key, e.target.value)} readOnly={readOnly} className={cls} />
                      );
                    })()}
                    {list.map((i, n) => (
                      <span key={n} className="text-[11.5px]" style={{ color: i.level === 'error' ? 'var(--danger)' : 'oklch(45% 0.1 75)' }}>
                        {i.message}
                      </span>
                    ))}
                  </label>
                );
              })}
            </div>
          </section>
        ))}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={approving || errorCount > 0}
              className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-xl disabled:opacity-50"
            >
              {approving ? 'Creating referral…' : 'Approve & create referral'}
            </button>
            <button type="button" onClick={() => setShowReject((v) => !v)} className="border border-[var(--border)] bg-white font-display font-bold text-[13px] px-4 py-2.5 rounded-xl">
              Reject
            </button>
            <span className="text-[12px] text-[var(--muted)]">
              {errorCount > 0 ? `${errorCount} field${errorCount === 1 ? '' : 's'} to fix before approving.` : 'Checked against the fax? Approve creates the referral; intake happens next.'}
            </span>
          </div>
        )}
        {approveState?.error && <div className="text-[12.5px] text-[var(--danger)]">{approveState.error}</div>}
      </form>

      {showReject && !readOnly && (
        <form action={reject} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-wrap items-center gap-2">
          <input name="reason" placeholder="Why? e.g. not a referral, duplicate, wrong agency" className="flex-1 min-w-[260px] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white" />
          <button type="submit" disabled={rejecting} className="border border-[var(--danger)] text-[var(--danger)] font-display font-bold text-[12.5px] px-4 py-2 rounded-lg">
            {rejecting ? 'Rejecting…' : 'Reject document'}
          </button>
          {rejectState?.error && <span className="text-[12.5px] text-[var(--danger)]">{rejectState.error}</span>}
        </form>
      )}
    </div>
  );
}
