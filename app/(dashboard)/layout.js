import Sidebar from "@/components/Sidebar";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/actions/auth";

export default async function DashboardLayout({ children }) {
  const session = await getSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 px-10 py-8">
        {session && (
          <div className="flex items-center justify-end gap-3 mb-4 -mt-2">
            <span className="text-[12.5px] text-[var(--muted)]">
              Signed in as <strong className="text-[oklch(30%_0.02_80)]">{session.name}</strong>
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
        {children}
      </main>
    </div>
  );
}
