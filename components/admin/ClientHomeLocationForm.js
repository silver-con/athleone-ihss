'use client';

import { useActionState } from 'react';
import { setClientHomeLocationAction, clearClientHomeLocationAction } from '@/actions/care-plans';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal bg-white';
const SOURCE_LABEL = {
  learned: "Learned from a caregiver's GPS clock-in at home",
  from_visit: "Taken from a visit's clock-in/out by office staff",
  entered: 'Entered by office staff',
};

// Home location for distance-from-home on EVV screens. `home` is
// { lat, lng, source, setAt, setBy, mapHref } or null.
export default function ClientHomeLocationForm({ clientId, home }) {
  const [setState, setAction, setPending] = useActionState(setClientHomeLocationAction, {});
  const [clearState, clearAction, clearPending] = useActionState(clearClientHomeLocationAction, {});
  const message = setState?.error || clearState?.error || setState?.success || clearState?.success;
  const isError = Boolean(setState?.error || clearState?.error);

  return (
    <div className="mt-6 pt-5 border-t border-[oklch(93%_0.01_85)]">
      <div className="font-display font-extrabold text-[13.5px]">Home location</div>
      {home ? (
        <p className="text-[12.5px] text-[var(--muted)] mt-1">
          {SOURCE_LABEL[home.source] || 'Set'}
          {home.setAt ? ` · ${home.setAt}` : ''}
          {home.setBy ? ` · ${home.setBy}` : ''}
          {home.mapHref && (
            <>
              {' · '}
              <a href={home.mapHref} target="_blank" rel="noopener noreferrer" className="font-display font-bold text-[var(--accent)] underline">view on map</a>
            </>
          )}
        </p>
      ) : (
        <p className="text-[12.5px] text-[var(--muted)] mt-1">
          Not set yet. It&rsquo;s learned automatically from the first accurate GPS clock-in a caregiver marks as
          &ldquo;Client&rsquo;s home&rdquo;, or paste it below. Distances from home show on EVV screens once it&rsquo;s set.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 mt-3">
        <form action={setAction} className="flex items-end gap-2">
          <input type="hidden" name="clientId" value={clientId} />
          <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
            {home ? 'Replace with' : 'Coordinates or map link'}
            <input name="coordinates" required placeholder="26.075175, -97.473486" className={field + ' w-[260px]'} />
          </label>
          <button type="submit" disabled={setPending} className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60">
            {setPending ? 'Saving…' : 'Save'}
          </button>
        </form>
        {home && (
          <form action={clearAction}>
            <input type="hidden" name="clientId" value={clientId} />
            <button type="submit" disabled={clearPending} className="border border-[var(--border)] bg-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60">
              {clearPending ? 'Clearing…' : 'Clear'}
            </button>
          </form>
        )}
      </div>
      {message && (
        <div className={'text-[12px] font-display font-bold mt-2 ' + (isError ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>{message}</div>
      )}
    </div>
  );
}
