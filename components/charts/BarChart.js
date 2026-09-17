// Minimal horizontal bar chart for magnitude comparisons (referrals by payer,
// caseload by caregiver). One sequential hue per the data-viz guidance —
// categorical color isn't needed here since the categories are already named
// on the axis. Thin bars, rounded far-end, direct value labels.

// `threshold` (optional) draws a vertical marker line at that value on the
// same scale — e.g. a required compliance minimum — and bars below it fall
// back to the danger color regardless of `barColor`, so failing a threshold
// is never conveyed by the marker line alone. `scaleMax` (optional) fixes
// the axis scale (use for percentages, e.g. 100) instead of scaling
// relative to the data's own max, which would visually flatten a threshold.
export default function BarChart({ data, unit = '', barColor = 'var(--accent-strong)', threshold, scaleMax }) {
  const max = scaleMax || Math.max(1, ...data.map((d) => d.value), threshold || 0);
  const thresholdPct = threshold != null ? Math.min(100, Math.round((threshold / max) * 100)) : null;

  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        const belowThreshold = threshold != null && d.value < threshold;
        return (
          <div key={d.label} className="flex items-center gap-3" title={`${d.label}: ${d.value}${unit}`}>
            <div className="w-[132px] shrink-0 text-[12.5px] text-[var(--text)] truncate">{d.label}</div>
            <div className="relative flex-1 h-[10px] rounded-full bg-[oklch(93%_0.006_85)] overflow-visible">
              <div
                className="h-full rounded-full"
                style={{ width: pct + '%', background: belowThreshold ? 'var(--danger)' : barColor }}
              />
              {thresholdPct != null && (
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-[var(--text)]"
                  style={{ left: thresholdPct + '%' }}
                  title={`Required minimum: ${threshold}${unit}`}
                />
              )}
            </div>
            <div
              className={
                'w-[54px] shrink-0 text-[12.5px] font-display font-bold text-right tabular-nums ' +
                (belowThreshold ? 'text-[var(--danger)]' : '')
              }
            >
              {d.value}{unit}
            </div>
          </div>
        );
      })}
    </div>
  );
}
