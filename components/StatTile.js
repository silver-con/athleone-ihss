export default function StatTile({ num, label, accent }) {
  return (
    <div className="flex-1 min-w-[140px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-[18px] py-3.5">
      <div
        className="font-display font-extrabold text-[22px]"
        style={accent ? { color: accent } : undefined}
      >
        {num}
      </div>
      <div className="text-[12px] text-[var(--muted)] mt-0.5">{label}</div>
    </div>
  );
}
