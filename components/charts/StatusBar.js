// Single segmented bar for a part-to-whole breakdown (referral status).
// Small, fixed categorical set (n=3) — color plus an always-visible legend
// label, never color alone, per the data-viz status-color rule.

export default function StatusBar({ segments }) {
  const total = Math.max(1, segments.reduce((sum, s) => sum + s.value, 0));

  return (
    <div>
      <div className="flex gap-[2px] h-[14px] w-full">
        {segments.map((s, i) => {
          const pct = (s.value / total) * 100;
          if (pct <= 0) return null;
          const isFirst = i === 0;
          const isLast = i === segments.length - 1;
          return (
            <div
              key={s.key}
              title={`${s.label}: ${s.value}`}
              style={{
                width: pct + '%',
                background: s.color,
                borderTopLeftRadius: isFirst ? 999 : 0,
                borderBottomLeftRadius: isFirst ? 999 : 0,
                borderTopRightRadius: isLast ? 999 : 0,
                borderBottomRightRadius: isLast ? 999 : 0,
              }}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3.5">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-[var(--muted)]">{s.label}</span>
            <span className="font-display font-bold">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
