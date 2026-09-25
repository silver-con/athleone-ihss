'use client';

import { useActionState, useState } from 'react';
import { saveDocusignConnectKeyAction } from '@/actions/docusign';

export default function DocusignConnectForm({ webhookUrl, configured, lastEventAt, connectionSaved }) {
  const [state, action, pending] = useActionState(saveDocusignConnectKeyAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-display font-extrabold text-[14.5px]">Automatic status updates (DocuSign Connect)</div>
          <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
            With Connect on, DocuSign tells Hearth the moment an envelope is completed — onboarding packets and
            orientations flip to signed without anyone pressing &ldquo;check status&rdquo;.
          </p>
        </div>
        <span className="text-[11px] font-display font-bold uppercase tracking-wide rounded-full px-2.5 py-1 border border-[var(--border)] whitespace-nowrap">
          {configured ? (lastEventAt ? 'Receiving' : 'Waiting for first event') : 'Off'}
        </span>
      </div>
      <ol className="text-[12.5px] text-[var(--muted)] list-decimal pl-5 mt-3 flex flex-col gap-1.5 max-w-[700px]">
        <li>
          In DocuSign: <strong className="text-[var(--text)]">Settings → Connect → Add configuration → Custom</strong>.
        </li>
        <li>
          URL to publish to:
          <div className="flex items-center gap-2 mt-1">
            <code className="font-mono text-[11.5px] bg-[oklch(97%_0.006_85)] border border-[var(--border)] rounded-lg px-2 py-1 break-all">{webhookUrl || 'Set APP_BASE_URL on the server to see this address'}</code>
            {webhookUrl && (
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(webhookUrl).then(() => setCopied(true))}
                className="text-[11.5px] font-display font-bold text-[var(--accent)]"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        </li>
        <li>Data format <strong className="text-[var(--text)]">JSON (SIM)</strong>; event <strong className="text-[var(--text)]">Envelope Completed</strong>; don&rsquo;t include documents.</li>
        <li>
          Turn on <strong className="text-[var(--text)]">Include HMAC signature</strong>, create a key under Connect → HMAC keys, and paste it
          below.
        </li>
      </ol>
      {!connectionSaved ? (
        <p className="text-[12.5px] text-[oklch(45%_0.1_75)] mt-3">Save the DocuSign connection above first.</p>
      ) : (
        <form action={action} className="flex flex-wrap items-center gap-2 mt-4">
          <input
            name="hmacKey"
            type="password"
            autoComplete="off"
            placeholder={configured ? '•••••••• saved — paste a new key to replace' : 'HMAC key'}
            className="flex-1 min-w-[260px] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white font-mono"
          />
          <button type="submit" disabled={pending} className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60">
            {pending ? 'Saving…' : 'Save key'}
          </button>
          {configured && (
            <button type="submit" name="remove" value="1" formNoValidate className="border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px]">
              Remove
            </button>
          )}
        </form>
      )}
      {lastEventAt && <p className="text-[12px] text-[var(--muted)] mt-2">Last event received {new Date(lastEventAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}.</p>}
      {state?.error && <p className="text-[12.5px] text-[var(--danger)] mt-2">{state.error}</p>}
      {state?.success && <p className="text-[12.5px] text-[var(--success)] mt-2">{state.success}</p>}
    </section>
  );
}
