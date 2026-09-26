import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { logoutAction } from '@/actions/auth';
import { getCaregiver, getOnboardingState, getCaregiverUnreadMessageCount } from '@/lib/queries';
import CaregiverTabs from './CaregiverTabs';
import InstallAppBanner from '@/components/caregiver/InstallAppBanner';

function initials(name) {
  return (name || '').split(' ').map((p) => p[0]).slice(0, 2).join('');
}

export default async function CaregiverLayout({ children }) {
  const session = await getSession();
  const me = session?.caregiverId ? await getCaregiver(session.organizationId, session.caregiverId) : null;
  // While onboarding is outstanding, keep a way back to the checklist on
  // every screen — it's the one thing she needs to finish.
  const onboarding =
    session?.caregiverId && me && ['applicant', 'onboarding'].includes(me.status)
      ? await getOnboardingState(session.organizationId, session.caregiverId)
      : null;
  const showOnboardingBanner = onboarding && !onboarding.caregiverStepsComplete;
  const unreadMessages = session?.caregiverId ? await getCaregiverUnreadMessageCount(session.organizationId, session.caregiverId) : 0;

  return (
    // On a phone (and in the installed app / APK) this fills the screen; on
    // a laptop it keeps the phone-frame preview used in demos.
    <div className="min-h-[100dvh] flex items-start justify-center sm:py-8 sm:px-4">
      <div className="w-full sm:max-w-[430px] bg-[var(--bg)] sm:rounded-[36px] sm:border border-[var(--border)] sm:shadow-[0_20px_50px_-20px_oklch(20%_0.02_80_/_0.35)] overflow-hidden flex flex-col h-[100dvh] sm:h-[860px]">
        {/* Header */}
        <div className="shrink-0 bg-[var(--surface)] border-b border-[var(--border)] px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-[26px] h-[26px] rounded-lg bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11.5 12 4l9 7.5" />
                  <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
                </svg>
              </div>
              <span className="font-display font-extrabold text-[15px]">Athleone</span>
            </div>
            {/* Demo-only link back to the landing page; hidden on phones. */}
            <Link href="/" className="hidden sm:inline text-[11.5px] font-display font-bold text-[var(--muted)]">
              Exit app
            </Link>
          </div>

          <div className="flex items-center gap-3 mt-3.5">
            <div className="w-[42px] h-[42px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-display font-extrabold text-[15px] shrink-0">
              {initials(me?.name || '')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display font-extrabold text-[15.5px] truncate">{me?.name}</div>
              <div className="text-[11.5px] text-[var(--muted)]">{me?.role}</div>
            </div>
            <Link
              href="/account/security"
              className="text-[11px] font-display font-bold text-[var(--muted)] border border-[var(--border)] rounded-[8px] px-2 py-1.5 shrink-0"
            >
              Account
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-[11px] font-display font-bold text-[var(--muted)] border border-[var(--border)] rounded-[8px] px-2 py-1.5 shrink-0"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <InstallAppBanner />

        {showOnboardingBanner && (
          <Link
            href="/caregiver/onboarding"
            className="shrink-0 flex items-center justify-between gap-3 bg-[var(--accent-soft)] border-b border-[var(--border)] px-5 py-2.5"
          >
            <span className="text-[12px] font-display font-bold text-[var(--accent)]">
              Finish setting up your account
            </span>
            <span className="text-[11.5px] font-display font-bold text-[var(--accent)] shrink-0">
              {
                [
                  onboarding.applicationSubmitted,
                  onboarding.packetSigned,
                  onboarding.trainingComplete,
                ].filter(Boolean).length
              }{' '}
              of 3 →
            </span>
          </Link>
        )}

        {/* Page content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">{children}</div>

        <CaregiverTabs badges={{ unreadMessages }} />
      </div>
    </div>
  );
}
