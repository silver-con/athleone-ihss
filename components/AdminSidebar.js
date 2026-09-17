'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  {
    href: '/admin',
    label: 'Overview',
    match: (path) => path === '/admin',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="9" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="14" width="8" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/admin/caregivers',
    label: 'Caregivers',
    match: (path) => path.startsWith('/admin/caregivers'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2" />
      </svg>
    ),
  },
  {
    href: '/admin/clients',
    label: 'Clients',
    match: (path) => path.startsWith('/admin/clients'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20" />
        <circle cx="9.5" cy="8" r="3.2" />
        <path d="M19 20v-1.5a3.2 3.2 0 0 0-2.2-3" />
        <path d="M15 5.3a3.2 3.2 0 0 1 0 6" />
      </svg>
    ),
  },
  {
    href: '/admin/training',
    label: 'Training',
    match: (path) => path.startsWith('/admin/training'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="12.5" rx="2" />
        <path d="M10 9.2v4.1l3.6-2.05z" />
        <path d="M8 21h8" />
      </svg>
    ),
  },
  {
    href: '/admin/care-plans',
    label: 'Care Plans',
    match: (path) => path.startsWith('/admin/care-plans') || path.match(/^\/admin\/clients\/[^/]+\/care-plan/),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3.5h6.5L19 8v11.5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
        <path d="M14 3.5V8h5" />
        <path d="M9.5 12h6M9.5 15h6M9.5 18h3.5" />
      </svg>
    ),
  },
  {
    href: '/admin/schedule',
    label: 'Schedule',
    match: (path) => path.startsWith('/admin/schedule'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9.5h18" />
        <path d="M8 3v3M16 3v3" />
      </svg>
    ),
  },
  {
    href: '/admin/finance',
    label: 'Finance',
    match: (path) => path.startsWith('/admin/finance'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    ),
  },
  {
    href: '/admin/evv',
    label: 'EVV Compliance',
    match: (path) => path.startsWith('/admin/evv'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-4.3-7-10.5V5.2L12 3l7 2.2v5.3C19 16.7 12 21 12 21Z" />
        <path d="M9 11.5l2 2 4-4.2" />
      </svg>
    ),
  },
  {
    href: '/admin/compliance',
    label: 'TX Compliance Center',
    match: (path) => path.startsWith('/admin/compliance'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M5 7h5.2M4 7l-1.8 4.5a2.7 2.7 0 0 0 5.4 0L6 7" />
        <path d="M19 7h-5.2M20 7l1.8 4.5a2.7 2.7 0 0 1-5.4 0L18 7" />
        <path d="M7 21h10" />
      </svg>
    ),
  },
  {
    href: '/admin/esign',
    label: 'E-Signature',
    match: (path) => path.startsWith('/admin/esign'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h16" />
        <path d="M6 17.5 16 7.5a1.8 1.8 0 0 0-2.5-2.5L3.5 15v2.5H6Z" />
      </svg>
    ),
  },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <div className="no-print w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col p-4">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 pb-1">
        <div className="w-[34px] h-[34px] rounded-xl bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
          </svg>
        </div>
        <div className="font-display font-extrabold text-[17px]">Hearth</div>
      </Link>
      <div className="px-1.5 pb-5 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)]">
        Admin
      </div>

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
          href="/referrals"
          className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] font-display font-bold text-[12.5px] text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Intake Portal
        </Link>
        <Link
          href="/caregiver"
          className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] font-display font-bold text-[12.5px] text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="7" y="2.5" width="10" height="16" rx="2" />
          </svg>
          Caregiver App
        </Link>
      </div>
    </div>
  );
}
