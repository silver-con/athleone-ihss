import Link from "next/link";
import AdminSidebar from "@/components/AdminSidebar";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/actions/auth";

export default async function AdminLayout({ children }) {
  const session = await getSession();

  return (
    <div className="flex min-h-screen">
      <AdminSidebar role={session?.role} />
      <main className="flex-1 min-w-0 px-10 py-8">
        {session && (
          <div className="no-print flex items-center justify-end gap-3 mb-4 -mt-2">
            <span className="text-[12.5px] text-[var(--muted)]">
              Signed in as <strong className="text-[oklch(30%_0.02_80)]">{session.name}</strong>
            </span>
            <Link href="/account/security" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
              Account
            </Link>
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
