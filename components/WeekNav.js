import Link from 'next/link';
import { addDays, mondayOf, todayIso, weekRangeLabel } from '@/lib/calendar';

// Previous / this week / next links for any page that shows one week of
// visits. The week travels in the URL (?week=YYYY-MM-DD, a Monday), so it
// survives reloads and can be shared.
export default function WeekNav({ basePath, weekStart }) {
  const current = mondayOf(todayIso());
  const isCurrent = weekStart === current;
  const link = 'text-[12.5px] font-display font-bold px-3 py-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] hover:bg-white';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link href={`${basePath}?week=${addDays(weekStart, -7)}`} className={link} aria-label="Previous week">←</Link>
      <div className="font-display font-extrabold text-[14px] px-1 min-w-[150px] text-center">{weekRangeLabel(weekStart)}</div>
      <Link href={`${basePath}?week=${addDays(weekStart, 7)}`} className={link} aria-label="Next week">→</Link>
      {!isCurrent && (
        <Link href={basePath} className={link + ' text-[var(--accent)]'}>This week</Link>
      )}
    </div>
  );
}
