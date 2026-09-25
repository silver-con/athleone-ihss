'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/platform', label: 'Overview' },
  { href: '/platform/admins', label: 'Team' },
  { href: '/platform/communications', label: 'Email & SMS' },
];

// Lightweight two-tab nav for the /platform area now that it has grown
// past the single page described in app/platform/layout.js's top comment
// — deliberately not the full AdminSidebar (still no tenant-scoped nav
// items here, see that file), just enough to move between the agency
// overview and the platform team screen.
export default function PlatformNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = tab.href === '/platform' ? pathname === '/platform' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              'text-[12.5px] font-display font-bold px-3 py-1.5 rounded-lg ' +
              (isActive
                ? 'bg-[var(--accent-strong)] text-white'
                : 'text-[var(--muted)] hover:bg-[oklch(96%_0.006_85)]')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
