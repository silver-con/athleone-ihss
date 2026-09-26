import Link from 'next/link';

// The centered card used by the sign-in family of pages (login, verify,
// forgot/reset password).
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-[34px] h-[34px] rounded-xl bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
            </svg>
          </div>
          <div className="font-display font-extrabold text-[19px]">Athleone</div>
        </Link>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-7">
          <h1 className="font-display font-extrabold text-[19px] mb-1">{title}</h1>
          {subtitle && <p className="text-[13px] text-[var(--muted)] mb-6">{subtitle}</p>}
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}

export const inputClass =
  'border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] w-full';
export const primaryButton =
  'bg-[var(--accent-strong)] text-white font-display font-bold text-[14px] rounded-xl py-2.5 disabled:opacity-60 w-full';
export const labelClass = 'text-[12.5px] font-display font-bold text-[var(--muted)]';

export function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div className="text-[13px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5">
      {children}
    </div>
  );
}

export function InfoBox({ children }) {
  if (!children) return null;
  return (
    <div className="text-[13px] font-display font-medium text-[var(--success)] bg-[var(--success-soft)] border border-[oklch(85%_0.06_150)] rounded-xl px-3.5 py-2.5">
      {children}
    </div>
  );
}
