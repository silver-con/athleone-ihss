import Link from 'next/link';
import LoginForm from './LoginForm';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = typeof params?.next === 'string' ? params.next : '';

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
          <div className="font-display font-extrabold text-[19px]">Hearth</div>
        </Link>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-7">
          <h1 className="font-display font-extrabold text-[19px] mb-1">Sign in</h1>
          <p className="text-[13px] text-[var(--muted)] mb-6">
            Use one of the demo accounts from the README, or your own if you&rsquo;ve reseeded.
          </p>
          <LoginForm next={next} />
        </div>

        <p className="text-center text-[12px] text-[var(--muted)] mt-5">
          New agency? Hearth sets your account up for you — contact your Hearth representative.
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
