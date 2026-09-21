import { getSession } from '@/lib/auth';
import { logoutAction } from '@/actions/auth';
import PlatformNav from '@/components/platform/PlatformNav';

// Deliberately not the same shell as app/admin/layout.js: no AdminSidebar
// (that component's nav is entirely tenant-scoped pages — Caregivers,
// Clients, Finance, EVV Compliance for ONE agency — none of which apply
// here), and no link back into any tenant's data. As of the platform-team
// screen (app/platform/admins), this area is two pages instead of one, so
// PlatformNav below is a plain two-tab switcher between them — still not
// an AdminSidebar, and still nothing tenant-scoped (see architecture spec
// §3 / the deferred-backlog note on why this role stays deliberately
// narrow).
export default async function PlatformLayout({ children }) {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-[1100px] mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-[30px] h-[30px] rounded-lg bg-[var(--accent-strong)] flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5.5 10v9.5a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1V10" />
              </svg>
            </div>
            <div className="font-display font-extrabold text-[17px]">Hearth</div>
            <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] bg-[oklch(96%_0.006_85)] rounded-full px-2.5 py-1 ml-1">
              Platform
            </div>
          </div>
          {session && (
            <div className="flex items-center gap-3">
              <span className="text-[12.5px] text-[var(--muted)]">
                Signed in as <strong className="text-[oklch(30%_0.02_80)]">{session.name}</strong>
                {session.platformRole && (
                  <>
                    {' '}
                    <span className="text-[11px] font-display font-bold uppercase tracking-wide">
                      ({session.platformRole === 'full' ? 'Full admin' : 'Support'})
                    </span>
                  </>
                )}
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="text-[12.5px] font-display font-bold text-[var(--accent)]"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
        <div className="max-w-[1100px] mx-auto px-8 pb-3">
          <PlatformNav />
        </div>
      </div>
      <main className="max-w-[1100px] mx-auto px-8 py-8">{children}</main>
    </div>
  );
}
