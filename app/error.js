'use client';

// Friendly error screen for anything that throws while rendering a page.
// In production Next.js replaces the real message with a digest, so no
// stack traces or SQL reach the browser; the digest matches the server log.
import Link from 'next/link';

export default function Error({ error, reset }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="max-w-[440px] text-center">
        <div className="font-display font-extrabold text-[20px]">Something went wrong</div>
        <p className="text-[13.5px] text-[var(--muted)] mt-2">
          That page hit an error. Try again — if it keeps happening, tell your Hearth contact and mention this code:
        </p>
        {error?.digest && <p className="font-mono text-[12px] mt-2 text-[var(--muted)]">{error.digest}</p>}
        <div className="flex justify-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => reset()}
            className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-4 py-2.5 rounded-xl"
          >
            Try again
          </button>
          <Link href="/" className="border border-[var(--border)] font-display font-bold text-[13px] px-4 py-2.5 rounded-xl">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
