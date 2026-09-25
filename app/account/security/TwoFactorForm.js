'use client';

import { useActionState, useState } from 'react';
import { saveTwoFactorAction } from '@/actions/account';
import { inputClass, primaryButton, labelClass, ErrorBox, InfoBox } from '@/components/auth/AuthShell';

export default function TwoFactorForm({ method, mobilePhone, fallbackPhone, email, required, smsLive, emailLive }) {
  const [state, action, pending] = useActionState(saveTwoFactorAction, {});
  const [choice, setChoice] = useState(method === 'off' && required ? 'email' : method);

  const options = [
    ...(required ? [] : [['off', 'Off', 'Just your password.']]),
    ['email', 'Email me a code', `Sent to ${email}.${emailLive ? '' : ' (Email isn’t connected on this server yet.)'}`],
    ['sms', 'Text me a code', `Sent to your mobile.${smsLive ? '' : ' (Texting isn’t connected on this server yet.)'}`],
  ];

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        {options.map(([value, label, hint]) => (
          <label
            key={value}
            className={
              'flex items-start gap-3 border rounded-xl px-3.5 py-3 cursor-pointer ' +
              (choice === value ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]')
            }
          >
            <input type="radio" name="method" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1" />
            <span>
              <span className="block font-display font-bold text-[13.5px]">{label}</span>
              <span className="block text-[12px] text-[var(--muted)]">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === 'sms' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobilePhone" className={labelClass}>
            Mobile number
          </label>
          <input
            id="mobilePhone"
            name="mobilePhone"
            type="tel"
            defaultValue={mobilePhone || ''}
            placeholder={fallbackPhone || '(512) 555-0147'}
            className={inputClass}
          />
          {fallbackPhone && !mobilePhone && (
            <span className="text-[12px] text-[var(--muted)]">Leave blank to use the number your agency has on file.</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className={labelClass}>
          Your current password (to confirm it’s you)
        </label>
        <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </div>
      <ErrorBox>{state?.error}</ErrorBox>
      <InfoBox>{state?.success}</InfoBox>
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
