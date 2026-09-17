'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  {
    href: '/caregiver/schedule',
    label: 'Schedule',
    match: (p) => p.startsWith('/caregiver/schedule') || p.startsWith('/caregiver/visit'),
    icon: (active) => (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9.5h18" />
        <path d="M8 3v3M16 3v3" />
      </svg>
    ),
  },
  {
    href: '/caregiver/messages',
    label: 'Messages',
    match: (p) => p.startsWith('/caregiver/messages'),
    icon: (active) => (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 3.5V17.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      </svg>
    ),
  },
  {
    href: '/caregiver/training',
    label: 'Training',
    match: (p) => p.startsWith('/caregiver/training'),
    icon: (active) => (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="12.5" rx="2" />
        <path d="M10 9.2v4.1l3.6-2.05z" />
        <path d="M8 21h8" />
      </svg>
    ),
  },
  {
    href: '/caregiver/clients',
    label: 'Clients',
    match: (p) => p.startsWith('/caregiver/clients'),
    icon: (active) => (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20" />
        <circle cx="9.5" cy="8" r="3.2" />
        <path d="M19 20v-1.5a3.2 3.2 0 0 0-2.2-3" />
        <path d="M15 5.3a3.2 3.2 0 0 1 0 6" />
      </svg>
    ),
  },
];

export default function CaregiverTabs() {
  const pathname = usePathname();

  return (
    <div className="shrink-0 bg-[var(--surface)] border-t border-[var(--border)] flex px-2 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              'flex-1 flex flex-col items-center gap-1 py-1.5 rounded-[12px] font-display font-bold text-[10.5px] ' +
              (active ? 'text-[var(--accent)]' : 'text-[var(--muted)]')
            }
          >
            {tab.icon(active)}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
