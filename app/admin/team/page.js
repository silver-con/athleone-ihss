import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOrgStaff, getLocations } from '@/lib/queries';
import CreateTeamMemberForm from '@/components/admin/CreateTeamMemberForm';
import TeamMemberControls from '@/components/admin/TeamMemberControls';

function formatWhen(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value));
}

const ROLE_LABEL = {
  ADMIN: 'Organization admin',
  LOCATION_ADMIN: 'Location admin',
  COORDINATOR: 'Coordinator',
};

const ROLE_BLURB = {
  ADMIN: 'Every location, plus organization settings',
  LOCATION_ADMIN: 'One location only',
  COORDINATOR: 'Intake and referrals',
};

export default async function AdminTeamPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [staff, locations] = await Promise.all([
    getOrgStaff(session.organizationId),
    getLocations(session.organizationId, { activeOnly: true }),
  ]);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Team</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Office accounts for this organization — who runs it, who runs each location, and who
        handles intake. Caregivers live on the{' '}
        <Link href="/admin/caregivers" className="font-display font-bold text-[var(--accent)]">
          Caregivers
        </Link>{' '}
        page with their HR record.
      </p>

      {locations.length === 0 && (
        <div className="bg-[oklch(97%_0.03_85)] border border-[oklch(85%_0.07_75)] rounded-2xl p-5 mt-6">
          <div className="font-display font-extrabold text-[14px]">
            Create a location before adding location admins
          </div>
          <p className="text-[13px] text-[var(--muted)] mt-1.5 max-w-[620px]">
            Every caregiver and client belongs to a location, even if this organization only
            operates one site. A location admin needs one to be scoped to.
          </p>
          <Link
            href="/admin/locations"
            className="inline-block mt-3 bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px]"
          >
            Go to Locations →
          </Link>
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.5fr_1.6fr_1.3fr_1.2fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Location / status</div>
        </div>

        {staff.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            No office accounts yet.
          </div>
        )}

        {staff.map((member) => (
          <div
            key={member.id}
            className={
              'grid grid-cols-[1.5fr_1.6fr_1.3fr_1.2fr] px-5 py-3.5 text-[13px] items-start border-b border-[oklch(93%_0.01_85)] last:border-none ' +
              (member.active ? '' : 'opacity-70')
            }
          >
            <div>
              <div className="font-display font-bold text-[14px]">
                {member.name}
                {member.id === session.userId && (
                  <span className="ml-2 text-[11px] font-body font-normal text-[var(--muted)]">
                    (you)
                  </span>
                )}
              </div>
              {member.id !== session.userId && <TeamMemberControls member={member} locations={locations} />}
            </div>
            <div className="text-[12.5px] text-[var(--muted)] break-all">{member.email}</div>
            <div>
              <div className="font-display font-bold text-[12.5px]">
                {ROLE_LABEL[member.role] || member.role}
              </div>
              <div className="text-[11.5px] text-[var(--muted)]">
                {ROLE_BLURB[member.role] || ''}
              </div>
            </div>
            <div className="text-[12.5px]">
              {member.locationName || (
                <span className="text-[var(--muted)]">Organization-wide</span>
              )}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {!member.active && (
                  <span className="text-[10.5px] font-display font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[oklch(93%_0.06_25)] text-[var(--danger)]">
                    Deactivated {formatWhen(member.deactivatedAt) || ''}
                  </span>
                )}
                {member.active && member.mustChangePassword && (
                  <span className="text-[10.5px] font-display font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]">
                    Password not yet set
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1">
                {member.lastLoginAt ? `Last sign-in ${formatWhen(member.lastLoginAt)}` : 'Never signed in'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <CreateTeamMemberForm locations={locations} />
    </div>
  );
}
