'use client';

import { useState, useTransition } from 'react';
import { startOrientationSigningAction, checkOrientationSigningStatusAction } from '@/actions/docusign';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12.5px] font-display font-bold';

export default function SendOrientationForSignature({
  orientationId,
  agencyRepDefault,
  envelopeId,
  signedVia,
  docusignConnected,
  baaOnFile,
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);
  const alreadySent = signedVia === 'docusign' && Boolean(envelopeId);

  const boundSend = startOrientationSigningAction.bind(null, orientationId);

  const checkStatus = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await checkOrientationSigningStatusAction(orientationId);
        if (r.error) setMessage({ tone: 'bad', text: r.error });
        else if (r.status === 'completed') setMessage({ tone: 'good', text: 'Signed — marked complete.' });
        else setMessage({ tone: 'warn', text: `Not signed yet (DocuSign status: ${r.status || 'unknown'}).` });
      } catch (err) {
        setMessage({ tone: 'bad', text: err.message || 'Something went wrong.' });
      }
    });

  if (!docusignConnected) {
    return (
      <div className="no-print bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 max-w-[860px]">
        <div className="font-display font-extrabold text-[14.5px] mb-1">Send for e-signature</div>
        <p className="text-[12.5px] text-[var(--muted)]">
          Connect DocuSign on the{' '}
          <a href="/admin/esign" className="text-[var(--accent)] font-display font-bold">
            E-Signature settings page
          </a>{' '}
          to send this for signature instead of on paper.
        </p>
      </div>
    );
  }

  if (!baaOnFile) {
    return (
      <div className="no-print bg-[oklch(93%_0.06_25)] border border-[oklch(85%_0.08_25)] rounded-2xl p-6 mt-6 max-w-[860px]">
        <div className="font-display font-extrabold text-[14.5px] mb-1 text-[var(--danger)]">
          Send for e-signature — blocked
        </div>
        <p className="text-[12.5px] text-[var(--danger)]">
          This document contains client information (name, HHSC individual number). DocuSign only signs a
          HIPAA BAA through a custom enterprise agreement — until that&rsquo;s confirmed and &ldquo;BAA on
          file&rdquo; is checked on the{' '}
          <a href="/admin/esign" className="font-display font-bold underline">
            E-Signature settings page
          </a>
          , this stays on paper.
        </p>
      </div>
    );
  }

  if (alreadySent) {
    return (
      <div className="no-print bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 max-w-[860px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display font-extrabold text-[14.5px] mb-1">Sent for e-signature</div>
            <p className="text-[12.5px] text-[var(--muted)]">
              Envelope {envelopeId} is out for the caregiver&rsquo;s signature. Check back here once
              they&rsquo;ve had a chance to sign.
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={checkStatus}
            className="shrink-0 border border-[var(--border)] font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Checking…' : 'Check signing status'}
          </button>
        </div>
        {message && (
          <p
            className={
              'text-[12.5px] font-display font-bold mt-3 ' +
              (message.tone === 'good'
                ? 'text-[var(--success)]'
                : message.tone === 'warn'
                  ? 'text-[oklch(45%_0.11_55)]'
                  : 'text-[var(--danger)]')
            }
          >
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="no-print bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 max-w-[860px]">
      <div className="font-display font-extrabold text-[14.5px] mb-1">Send for e-signature</div>
      <p className="text-[12.5px] text-[var(--muted)] mb-4">
        DocuSign emails the caregiver a link to sign the acknowledgment remotely.
      </p>
      <form
        action={(formData) =>
          startTransition(async () => {
            setMessage(null);
            const r = await boundSend(formData);
            if (r?.error) setMessage({ tone: 'bad', text: r.error });
          })
        }
        className="grid grid-cols-2 gap-4"
      >
        <label className={labelClass}>
          Date of orientation
          <input name="orientedOn" type="date" required className={field} />
        </label>
        <label className={labelClass}>
          Method
          <select name="method" defaultValue="in_person" className={field}>
            <option value="in_person">In-Person</option>
            <option value="telephone">Telephone</option>
            <option value="video">Video Conference</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className={labelClass}>
          Agency representative
          <input name="agencyRepName" defaultValue={agencyRepDefault} className={field} />
        </label>
        <label className={labelClass}>
          Notes
          <input name="notes" className={field} />
        </label>
        <div className="col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px] disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send for e-signature'}
          </button>
        </div>
      </form>
      {message && (
        <p className="text-[12.5px] font-display font-bold mt-3 text-[var(--danger)]">{message.text}</p>
      )}
    </div>
  );
}
