'use client';

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print border border-[var(--border)] rounded-[10px] px-4 py-2 text-[12.5px] font-display font-bold text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]"
    >
      Print / Save as PDF
    </button>
  );
}
