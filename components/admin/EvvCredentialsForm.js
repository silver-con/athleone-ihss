'use client';

import { useActionState } from 'react';
import { saveEvvCredentialsAction } from '@/actions/evv';

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function EvvCredentialsForm({ credentials }) {
  const [state, formAction, pending] = useActionState(saveEvvCredentialsAction, {
    error: null,
    saved: false,
  });
  const configured = Boolean(credentials);

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4" open={!configured}>
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        {configured ? 'Aggregator connection settings' : 'Set up the aggregator connection'}
      </summary>

      <p className="text-[12.5px] text-[var(--muted)] mt-2">
        These credentials are issued by HHAeXchange to this agency after its onboarding form and
        attestation are accepted. They&rsquo;re encrypted before storage and can&rsquo;t be read back —
        leave the secret fields blank to keep what&rsquo;s already saved.
      </p>

      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold mt-3">
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
          API base URL
          <input
            name="apiBaseUrl"
            required
            defaultValue={credentials?.apiBaseUrl || ''}
            placeholder="https://…"
            className={field}
          />
        </label>
        <label className={labelClass}>
          API version
          <input name="apiVersion" defaultValue={credentials?.apiVersion || '1'} className={field} />
        </label>

        <label className={labelClass}>
          Client ID {configured && <span className="font-body font-normal text-[var(--muted)]">(saved)</span>}
          <input name="clientId" type="password" autoComplete="off" placeholder={configured ? 'unchanged' : ''} className={field} />
        </label>
        <label className={labelClass}>
          Client secret {configured && <span className="font-body font-normal text-[var(--muted)]">(saved)</span>}
          <input name="clientSecret" type="password" autoComplete="off" placeholder={configured ? 'unchanged' : ''} className={field} />
        </label>

        <label className={labelClass}>
          Scope
          <input name="scope" defaultValue={credentials?.scope || ''} className={field} />
        </label>
        <label className={labelClass}>
          Environment
          <select name="environment" defaultValue={credentials?.environment || 'sandbox'} className={field}>
            <option value="sandbox">Sandbox / Implementation</option>
            <option value="production">Production</option>
          </select>
        </label>

        <label className={labelClass}>
          Provider Tax ID
          <input name="providerTaxId" defaultValue={credentials?.providerTaxId || ''} className={field} />
        </label>
        <label className={labelClass}>
          Payer ID
          <input name="payerId" defaultValue={credentials?.payerId || ''} className={field} />
        </label>

        <label className={labelClass}>
          Office qualifier
          <select name="officeQualifier" defaultValue={credentials?.officeQualifier || 'NPI'} className={field}>
            <option value="NPI">NPI</option>
            <option value="FederalTaxID">Federal Tax ID</option>
          </select>
        </label>
        <label className={labelClass}>
          Office identifier
          <input name="officeIdentifier" defaultValue={credentials?.officeIdentifier || ''} className={field} />
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
