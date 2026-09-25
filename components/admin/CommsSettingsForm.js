'use client';

import { useActionState } from 'react';
import { saveCommsSettingsAction } from '@/actions/communications';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';

const CHANNELS = [
  ['sms', 'Text message'],
  ['email', 'Email'],
  ['both', 'Text and email'],
  ['none', "Don't notify (they'll see it next time they open the app)"],
];

export default function CommsSettingsForm({ notifyEmail, caregiverNotifyChannel }) {
  const [state, formAction, pending] = useActionState(saveCommsSettingsAction, {});
  return (
    <form action={formAction} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 flex flex-col gap-4">
      <div>
        <div className="font-display font-extrabold text-[15px]">Notifications</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 max-w-[640px]">
          Notices say only that a message is waiting — never the message itself or anything about a client — so no
          health information travels by text or email.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold max-w-[420px]">
        When the office replies to a caregiver, tell them by
        <select name="caregiverNotifyChannel" defaultValue={caregiverNotifyChannel} className={field}>
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold max-w-[420px]">
        Office email for new caregiver messages
        <input name="notifyEmail" type="email" defaultValue={notifyEmail || ''} placeholder="office@youragency.com" className={field} />
        <span className="font-normal text-[var(--muted)] text-[12px]">Leave blank to skip the email — messages still show on the Messages page.</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state?.error && <span className="text-[12.5px] text-[var(--danger)]">{state.error}</span>}
        {state?.success && <span className="text-[12.5px] text-[var(--success)]">{state.success}</span>}
      </div>
    </form>
  );
}
