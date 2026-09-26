'use client';

import { useActionState, useState, useTransition } from 'react';
import { generateFaxWebhookTokenAction, saveFaxNumberAction } from '@/actions/intake';

// Admin-only: connect the agency's fax provider (see docs/FAX-INTAKE.md).
export default function FaxSettingsPanel({ webhookBase, faxNumber, webhookConfigured }) {
  const [token, setToken] = useState(null);
  const [pending, start] = useTransition();
  const [numState, saveNumber, savingNumber] = useActionState(saveFaxNumberAction, {});
  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <summary className="cursor-pointer font-display font-extrabold text-[14px]">
        Connect a fax line {webhookConfigured ? '· connected' : '· not connected'}
      </summary>
      <div className="text-[12.5px] text-[var(--muted)] mt-3 flex flex-col gap-3 max-w-[760px]">
        <p>
          Use a HIPAA-compliant e-fax service with a signed BAA that can send each incoming fax to a webhook. In the
          provider&rsquo;s settings, set <strong className="text-[var(--text)]">incoming fax → webhook (HTTP POST)</strong> to the address
          below and add the secret as an <span className="font-mono">Authorization: Bearer</span> header (or, if it can&rsquo;t send
          headers, append <span className="font-mono">&amp;token=SECRET</span> to the address).
        </p>
        <div>
          <div className="font-display font-bold text-[var(--text)] mb-1">Webhook address</div>
          <code className="block font-mono text-[11.5px] bg-[oklch(97%_0.006_85)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 break-all">
            {webhookBase || 'Set APP_BASE_URL on the server to see the address'}
          </code>
        </div>
        <div>
          <div className="font-display font-bold text-[var(--text)] mb-1">Secret</div>
          {token ? (
            <div>
              <code className="block font-mono text-[12px] bg-[var(--success-soft)] rounded-lg px-2.5 py-1.5 break-all">{token}</code>
              <div className="mt-1">Copy it into the fax provider now — it won&rsquo;t be shown again.</div>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => setToken((await generateFaxWebhookTokenAction()).token))}
              className="border border-[var(--border)] bg-white font-display font-bold text-[12px] px-3 py-1.5 rounded-lg"
            >
              {webhookConfigured ? 'Generate a new secret (the old one stops working)' : 'Generate secret'}
            </button>
          )}
        </div>
        <form action={saveNumber} className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold text-[var(--text)]">Agency fax number</span>
          <input name="faxNumber" defaultValue={faxNumber || ''} placeholder="(512) 555-0199" className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-[13px] bg-white" />
          <button type="submit" disabled={savingNumber} className="border border-[var(--border)] bg-white font-display font-bold text-[12px] px-3 py-1.5 rounded-lg">
            Save
          </button>
          {numState?.success && <span className="text-[var(--success)]">{numState.success}</span>}
        </form>
      </div>
    </details>
  );
}
