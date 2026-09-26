import Link from 'next/link';
import LoginForm from './LoginForm';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = typeof params?.next === 'string' ? params.next : '';
  const justReset = params?.reset === '1';

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[380px]">
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
          <h1 className="font-display font-extrabold text-[19px] mb-1">Sign in</h1>
          <p className="text-[13px] text-[var(--muted)] mb-6">
            Sign in with the account your agency set up for you.
          </p>
          {justReset && (
            <div className="text-[13px] font-display font-medium text-[var(--success)] bg-[var(--success-soft)] rounded-xl px-3.5 py-2.5 mb-4">
              Password changed. Sign in with your new password.
            </div>
          )}
          <LoginForm next={next} />
          <p className="text-center mt-4">
            <Link href="/forgot-password" className="text-[12.5px] font-display font-bold text-[var(--accent)]">
              Forgot your password?
            </Link>
          </p>
        </div>

        <p className="text-center text-[12px] text-[var(--muted)] mt-5">
          New agency? Athleone sets your account up for you — contact your Athleone representative.
        </p>
        <p className="text-center text-[12px] text-[var(--muted)] mt-2">
          <Link href="/" className="font-display font-bold text-[var(--accent)]">
            ← Back to overview
          </Link>
        </p>
      </div>
    </div>
  );
}
