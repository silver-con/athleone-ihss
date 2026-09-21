import { requireSession } from '@/actions/auth';
import { getAllPlatformAdmins, logPlatformAdminAccess } from '@/lib/queries';
import CreatePlatformAdminForm from '@/components/platform/CreatePlatformAdminForm';
import PlatformAdminStatusToggle from '@/components/platform/PlatformAdminStatusToggle';

// Platform team management — who else has PLATFORM_ADMIN access (support
// staff, other vendor-ops admins), separate from app/platform/page.js's
// list of agencies. Same access-control shape as that page: gated on
// requireSession(['PLATFORM_ADMIN']), every view and write logged to
// platform_admin_access_log. See actions/platform.js's comment on
// createPlatformAdminAction/togglePlatformAdminActiveAction for how this
// differs from onboarding a new agency (that grants a tenant's own staff
// access to their own data; this grants cross-tenant platform access, the
// same access the person granting it already has).
export default async function PlatformAdminsPage() {
  const session = await requireSession(['PLATFORM_ADMIN']);
  const admins = await getAllPlatformAdmins();
  await logPlatformAdminAccess(session.userId, 'view_team');

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Platform team</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Everyone with platform admin access &mdash; the same cross-tenant view you have.
        Deactivating someone here blocks their login immediately without deleting their account or
        its history in the access log. Support admins can view every agency and this list; only
        full admins can onboard a new agency or change who&rsquo;s on this list.
      </p>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl mt-6 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left border-b border-[var(--border)] bg-[oklch(97%_0.006_85)]">
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Name
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Email
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Role
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Status
              </th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                Added
              </th>
            </tr>
          </thead>
          <tbody>
            {admins.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">
                  No platform admins yet.
                </td>
              </tr>
            )}
            {admins.map((admin) => (
              <tr key={admin.id} className="border-b border-[var(--border)] last:border-b-0 align-top">
                <td className="px-4 py-3.5">
                  <div className="font-display font-bold text-[13.5px]">{admin.name}</div>
                </td>
                <td className="px-4 py-3.5 text-[var(--muted)]">{admin.email}</td>
                <td className="px-4 py-3.5">
                  <span
                    className={
                      'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap ' +
                      (admin.platformRole === 'full'
                        ? 'bg-[var(--amber-soft)] text-[var(--amber)]'
                        : 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]')
                    }
                  >
                    {admin.platformRole === 'full' ? 'Full admin' : 'Support'}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {admin.id === session.userId ? (
                    <span className="text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap bg-[oklch(94%_0.006_85)] text-[var(--muted)]">
                      You
                    </span>
                  ) : session.platformRole === 'full' ? (
                    <PlatformAdminStatusToggle platformAdminId={admin.id} active={admin.active} />
                  ) : (
                    <span
                      className={
                        'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap ' +
                        (admin.active
                          ? 'bg-[var(--success-soft)] text-[var(--success)]'
                          : 'bg-[var(--danger-soft)] text-[var(--danger)]')
                      }
                    >
                      {admin.active ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5 text-[var(--muted)] whitespace-nowrap">
                  {new Date(admin.createdAt).toLocaleDateString('en-US')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {session.platformRole === 'full' ? (
        <CreatePlatformAdminForm />
      ) : (
        <p className="text-[12.5px] text-[var(--muted)] mt-6">
          Adding a platform admin needs a full admin &mdash; ask one on your team.
        </p>
      )}
    </div>
  );
}
