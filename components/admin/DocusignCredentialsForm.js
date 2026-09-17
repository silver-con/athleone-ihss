'use client';

import { useActionState } from 'react';
import { saveDocusignCredentialsAction } from '@/actions/docusign';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function DocusignCredentialsForm({ credentials }) {
  const [state, formAction, pending] = useActionState(saveDocusignCredentialsAction, {
    error: null,
    saved: false,
  });
  const configured = Boolean(credentials);

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4" open={!configured}>
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        {configured ? 'DocuSign connection settings' : 'Connect DocuSign'}
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2">
        These come from your DocuSign developer (or production) account&rsquo;s Apps and Keys page —
        the Integration Key, the API Username of the account you&rsquo;re authorizing to send on the
        agency&rsquo;s behalf, and that account&rsquo;s Account ID. The private key is encrypted before
        storage and can&rsquo;t be read back — leave it blank to keep what&rsquo;s already saved.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3 whitespace-pre-wrap break-words">
          {state.error}
        </div>
      )}
      {state?.saved && !state?.error && (
        <div className="bg-[var(--success-soft)] text-[var(--success)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
          Saved.
        </div>
      )}

      <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
        <label className={labelClass}>
          Integration Key
          <input name="integrationKey" required defaultValue={credentials?.integrationKey || ''} className={field} />
        </label>
        <label className={labelClass}>
          Environment
          <select name="environment" defaultValue={credentials?.environment || 'demo'} className={field}>
            <option value="demo">Demo / Developer</option>
            <option value="production">Production</option>
          </select>
        </label>

        <label className={labelClass}>
          API Username (GUID)
          <input name="apiUsername" required defaultValue={credentials?.apiUsername || ''} className={field} />
        </label>
        <label className={labelClass}>
          Account ID
          <input name="accountId" required defaultValue={credentials?.accountId || ''} className={field} />
        </label>

        <label className={labelClass + ' col-span-2'}>
          Private Key {configured && <span className="font-body font-normal text-[var(--muted)]">(saved)</span>}
          <textarea
            name="privateKey"
            rows={5}
            autoComplete="off"
            placeholder={configured ? 'unchanged — paste a new key only to rotate it' : '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
            className={field + ' font-mono text-[11.5px]'}
          />
        </label>

        <label className="col-span-2 flex items-start gap-2.5 bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-xl px-3.5 py-3">
          <input
            type="checkbox"
            name="baaOnFile"
            defaultChecked={Boolean(credentials?.baaOnFile)}
            className="mt-0.5"
          />
          <span className="text-[12px] text-[oklch(42%_0.1_75)]">
            <strong className="font-display font-bold">A signed HIPAA BAA is on file with DocuSign for this account.</strong>{' '}
            Only check this once that&rsquo;s actually true — DocuSign only signs a BAA through a custom
            enterprise agreement, not the demo/developer tier or self-serve plans. Leaving this unchecked
            blocks the Attendant Orientation document (it contains client PHI) from being sent through
            DocuSign; the onboarding packet is unaffected either way, since it contains no PHI.
          </span>
        </label>

        <div className="col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save connection'}
          </button>
        </div>
      </form>
    </details>
  );
}
