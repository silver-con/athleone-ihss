'use client';

// A one-shot success banner driven by a `?toast=` query param set by a
// Server Action's redirect (see actions/*.js) — replaces the old
// Context-based `toast`/`setToast` state now that there's no shared
// client-side store. Clears the param from the URL once shown so a
// refresh doesn't re-show it.
import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export default function Toast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const message = searchParams.get('toast');

  // Tracks the last message the user dismissed, rather than a plain
  // visible/hidden flag kept in sync via an effect — that way a *new*
  // toast message still shows even though this component never unmounts
  // between navigations, with no render-triggered-by-effect involved.
  const [dismissedMessage, setDismissedMessage] = useState(null);
  const visible = Boolean(message) && message !== dismissedMessage;

  function dismiss() {
    setDismissedMessage(message);
    const params = new URLSearchParams(searchParams);
    params.delete('toast');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-[var(--success-soft)] border border-[oklch(80%_0.08_150)] text-[var(--success)] rounded-xl px-4 py-3 mt-6 font-semibold text-[13.5px]">
      <div className="flex items-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {message}
      </div>
      <button onClick={dismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
          <path d="M18 6 6 18" /><path d="M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
