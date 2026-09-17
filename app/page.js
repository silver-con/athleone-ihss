import Link from 'next/link';

const SECTIONS = [
  {
    href: '/referrals',
    title: 'Intake Portal',
    audience: 'Intake coordinator',
    description:
      "Process incoming referrals from health plans and hospitals, review a mocked-up referral fax, and complete client intake.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v5a1 1 0 0 0 1 1h5" />
        <path d="M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M8.5 13h7M8.5 16.5h4.5" />
      </svg>
    ),
  },
  {
    href: '/admin',
    title: 'Admin Dashboard',
    audience: 'Agency admin',
    description:
      'Agency-wide KPIs, caregiver roster and caseload assignment, a weekly visit schedule, and EVV compliance tracking.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="9" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="14" width="8" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/caregiver',
    title: 'Caregiver App',
    audience: 'Field caregiver',
    description:
      'A mobile companion for the visit schedule, EVV clock-in/out, the care plan checklist, messages with the office, and client profiles.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="2.5" width="12" height="19" rx="2.2" />
        <path d="M10.5 18.2h3" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[900px]">
        <div className="flex items-center gap-3 justify-center mb-2">
          <div className="w-[42px] h-[42px] rounded-xl bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
            </svg>
          </div>
          <div className="font-display font-extrabold text-[26px]">Hearth</div>
        </div>
        <p className="text-center text-[14px] text-[var(--muted)] max-w-[440px] mx-auto">
          One IHSS caregiver-agency prototype, three perspectives on the same data — pick a view to
          get started.
        </p>

        <div className="grid grid-cols-3 gap-4 mt-10 max-[820px]:grid-cols-1">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 hover:border-[var(--accent)] hover:shadow-[0_8px_24px_-12px_oklch(20%_0.02_80_/_0.25)] transition"
            >
              <div className="w-[44px] h-[44px] rounded-[14px] bg-[var(--accent-strong)] flex items-center justify-center mb-4">
                {s.icon}
              </div>
              <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1">
                {s.audience}
              </div>
              <div className="font-display font-extrabold text-[17px] mb-2">{s.title}</div>
              <p className="text-[13px] text-[var(--muted)] leading-relaxed">{s.description}</p>
              <div className="text-[12.5px] font-display font-bold text-[var(--accent)] mt-4 group-hover:underline">
                Open →
              </div>
            </Link>
          ))}
        </div>

        <p className="text-center text-[12px] text-[var(--muted)] mt-10">
          Backed by a real Postgres database with per-role sign-in — each card above requires
          logging in as that role. See the README for demo credentials.
        </p>
      </div>
    </div>
  );
}
