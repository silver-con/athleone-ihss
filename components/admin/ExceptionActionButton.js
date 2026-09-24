import Link from 'next/link';

// Entry point into visit maintenance from the EVV page and the Compliance
// Center queue. Until 2026-09-23 these were one-click buttons that flipped
// `resolved` / `vmur_submitted` with no reason code, note, contact or
// verifier — now every correction goes through the audited form at
// /admin/evv/visits/[id] (see performVisitMaintenance in lib/queries.js).
export default function ExceptionActionButton({ visitId, variant = 'review' }) {
  if (variant === 'vmur') {
    return (
      <Link
        href={`/admin/evv/visits/${visitId}`}
        className="text-[11.5px] font-display font-bold px-2.5 py-1.5 rounded-full bg-[var(--danger)] text-white whitespace-nowrap"
      >
        Record VMUR →
      </Link>
    );
  }
  return (
    <Link
      href={`/admin/evv/visits/${visitId}`}
      className="text-[11.5px] font-display font-bold px-2.5 py-1 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] whitespace-nowrap"
    >
      Fix &amp; verify →
    </Link>
  );
}
