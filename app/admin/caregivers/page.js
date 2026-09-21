import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getCaregivers,
  getClients,
  getAllLatestChecks,
  getAllCompletions,
  getCourses,
  getLocations,
  CHECK_TYPES,
} from '@/lib/queries';
import CaregiverStatusToggle from '@/components/admin/CaregiverStatusToggle';
import AddCaregiverForm from '@/components/admin/AddCaregiverForm';
import LocationAssignSelect from '@/components/admin/LocationAssignSelect';

// Credentialing state for the roster view: a caregiver is "attention
// needed" if any required check is missing or past its next-due date.
// The annual re-check is the requirement that lapses silently on paper,
// so it belongs on the roster rather than buried in a detail page.
function credentialingState(caregiverId, checks) {
  const mine = checks.filter((c) => c.caregiverId === caregiverId);
  const missing = CHECK_TYPES.filter((t) => !mine.some((c) => c.checkType === t.key)).length;
  const overdue = mine.filter(
    (c) => c.nextDueOn && new Date(c.nextDueOn) < new Date()
  ).length;
  const dueSoon = mine.filter((c) => {
    if (!c.nextDueOn) return false;
    const days = Math.floor((new Date(c.nextDueOn) - new Date()) / 86400000);
    return days >= 0 && days <= 30;
  }).length;

  if (missing > 0) return { label: `${missing} check${missing === 1 ? '' : 's'} missing`, tone: 'danger' };
  if (overdue > 0) return { label: `${overdue} overdue`, tone: 'danger' };
  if (dueSoon > 0) return { label: `${dueSoon} due soon`, tone: 'warn' };
  return { label: 'Up to date', tone: 'ok' };
}

const TONE_CLASS = {
  danger: 'text-[var(--danger)]',
  warn: 'text-[oklch(45%_0.11_55)]',
  ok: 'text-[var(--muted)]',
};

export default async function AdminCaregiversPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  // `locations` (every one, inactive included) feeds the reassignment
  // control an org admin uses to retire a branch's people; `hireLocations`
  // is what a new hire may be placed into — active only, and for a
  // location admin, only their own.
  const [caregivers, clients, checks, completions, courses, locations] = await Promise.all([
    getCaregivers(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getAllLatestChecks(session.organizationId, session.locationId),
    getAllCompletions(session.organizationId, session.locationId),
    getCourses(session.organizationId),
    getLocations(session.organizationId),
  ]);

  const canReassign = session.role === 'ADMIN';
  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const hireLocations = locations.filter(
    (l) => l.status === 'active' && (!session.locationId || l.id === session.locationId)
  );

  const initialCourseIds = new Set(
    courses.filter((c) => c.courseType === 'initial').map((c) => c.id)
  );

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Caregivers</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Agency roster — caseload, credentialing status and onboarding training
      </p>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.6fr_0.9fr_1.1fr_0.8fr_0.9fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Caregiver</div>
          <div>Role</div>
          <div>Location</div>
          <div>Clients</div>
          <div>Hours / week</div>
          <div>Credentialing</div>
          <div>Training</div>
          <div>Status</div>
        </div>

        {caregivers.map((cg) => {
          const assigned = clients.filter((c) => c.assignedCaregiverId === cg.id);
          const hours = assigned.reduce((sum, c) => sum + (c.authHoursNum || 0), 0);
          const cred = credentialingState(cg.id, checks);
          const done = completions.filter(
            (c) => c.caregiverId === cg.id && initialCourseIds.has(c.courseId)
          ).length;

          return (
            <div
              key={cg.id}
              className="grid grid-cols-[1.4fr_1fr_0.9fr_0.6fr_0.9fr_1.1fr_0.8fr_0.9fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
            >
              <div>
                <Link
                  href={`/admin/caregivers/${cg.id}`}
                  className="font-display font-bold text-[14.5px] text-[var(--accent)]"
                >
                  {cg.name}
                </Link>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">{cg.phone}</div>
              </div>
              <div>{cg.role}</div>
              <div className="pr-2">
                {canReassign ? (
                  <LocationAssignSelect
                    kind="caregiver"
                    recordId={cg.id}
                    locationId={cg.locationId}
                    locations={locations}
                  />
                ) : (
                  <span className="text-[12.5px] text-[var(--muted)]">
                    {locationById[cg.locationId]?.name || 'No location'}
                  </span>
                )}
              </div>
              <div>{assigned.length}</div>
              <div>{hours} hrs/wk</div>
              <div className={'text-[12.5px] font-display font-bold ' + TONE_CLASS[cred.tone]}>
                {cred.label}
              </div>
              <div className="text-[12.5px]">
                {initialCourseIds.size > 0 ? `${done} / ${initialCourseIds.size}` : '—'}
              </div>
              <div>
                <CaregiverStatusToggle caregiverId={cg.id} status={cg.status} />
              </div>
            </div>
          );
        })}
      </div>

      {hireLocations.length === 0 ? (
        <div className="bg-[oklch(97%_0.03_85)] border border-[oklch(85%_0.07_75)] rounded-2xl p-5 mt-4">
          <div className="font-display font-extrabold text-[14px]">
            Create a location first
          </div>
          <p className="text-[13px] text-[var(--muted)] mt-1.5 max-w-[620px]">
            Everyone and everything belongs to a location, even if this organization only
            operates one site. Create one and this form opens up.
          </p>
          <Link
            href="/admin/locations"
            className="inline-block mt-3 bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px]"
          >
            Go to Locations &rarr;
          </Link>
        </div>
      ) : (
        <AddCaregiverForm locations={hireLocations} />
      )}
    </div>
  );
}
