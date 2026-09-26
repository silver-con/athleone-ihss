'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  {
    href: '/referrals',
    label: 'Referrals',
    match: (path) => path.startsWith('/referrals'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v11H8l-4 4V5Z" />
      </svg>
    ),
  },
  {
    href: '/clients',
    label: 'Clients',
    match: (path) => path.startsWith('/clients'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20" />
        <circle cx="9.5" cy="8" r="3.2" />
        <path d="M19 20v-1.5a3.2 3.2 0 0 0-2.2-3" />
        <path d="M15 5.3a3.2 3.2 0 0 1 0 6" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col p-4">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 pb-5">
        <div className="w-[34px] h-[34px] rounded-xl bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
          </svg>
        </div>
        <div className="font-display font-extrabold text-[17px]">Athleone</div>
      </Link>

      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] font-display font-bold text-[13.5px] mb-1 ' +
              (active
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]')
            }
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}

      <div className="mt-auto pt-4 border-t border-[var(--border)] flex flex-col gap-1">
        <Link
          href="/admin"
          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-[10px] font-display font-bold text-[12.5px] text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]"
        >
          Admin Dashboard
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
        <Link
          href="/caregiver"
          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-[10px] font-display font-bold text-[12.5px] text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]"
        >
          Caregiver App
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
