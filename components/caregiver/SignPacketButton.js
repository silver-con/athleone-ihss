'use client';

import { useTransition } from 'react';
import { startPacketSigningAction } from '@/actions/docusign';

// startPacketSigningAction ends in a redirect() to DocuSign's own signing
// page (an external URL) — Next.js server actions support redirecting to
// external URLs the same way as internal ones, so calling it here just
// navigates the browser away; no client-side URL handling needed.
export default function SignPacketButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => startPacketSigningAction())}
      className="inline-block mt-3 bg-[var(--accent-strong)] text-white rounded-[10px] px-4 py-2 text-[12.5px] font-display font-bold disabled:opacity-60"
    >
      {pending ? 'Opening…' : 'Start signing'}
    </button>
  );
}
