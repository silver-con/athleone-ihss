import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getOrientation,
  getClient,
  getCaregiver,
  getOrganization,
  getActiveAuthorization,
  getVisitsForClient,
  getDocusignCredentials,
} from '@/lib/queries';
import { WEEK_DAYS } from '@/lib/data';
import { completeOrientationAction } from '@/actions/orientations';
import PrintButton from '@/components/admin/PrintButton';
import SendOrientationForSignature from '@/components/admin/SendOrientationForSignature';

const METHOD_LABELS = {
  in_person: 'In-Person',
  telephone: 'Telephone',
  video: 'Video Conference',
  other: 'Other',
};

const TYPE_LABELS = { initial: 'Initial', annual: 'Annual', other: 'Other' };

// Visit times are stored as "9:00 AM" labels; this turns a start/end pair
// into a decimal hours figure for the service-schedule table.
function hoursBetween(start, end) {
  const parse = (label) => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    return h * 60 + parseInt(m[2], 10);
  };
  const a = parse(start);
  const b = parse(end);
  if (a === null || b === null || b < a) return null;
  return (b - a) / 60;
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className="text-[13px] mt-0.5 min-h-[18px]">{value || '—'}</div>
    </div>
  );
}

export default async function OrientationDocumentPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const orientation = await getOrientation(session.organizationId, id);

  if (!orientation) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Orientation not found.{' '}
        <Link href="/admin/clients" className="text-[var(--accent)] font-display font-bold">
          Back to clients
        </Link>
      </div>
    );
  }

  const [client, caregiver, organization, authorization, visits, docusignCredentials] = await Promise.all([
    getClient(session.organizationId, orientation.clientId, session.locationId),
    getCaregiver(session.organizationId, orientation.caregiverId),
    getOrganization(session.organizationId),
    getActiveAuthorization(session.organizationId, orientation.clientId),
    getVisitsForClient(session.organizationId, orientation.clientId),
    getDocusignCredentials(session.organizationId),
  ]);

  // Weekly schedule: one representative visit per weekday for this
  // caregiver-client pairing. Rendered live rather than snapshotted, so the
  // document always shows the schedule as it currently stands.
  const scheduleRows = WEEK_DAYS.map((d) => {
    const visit = visits.find((v) => v.day === d.key && v.caregiverId === orientation.caregiverId);
    const hours = visit ? hoursBetween(visit.start, visit.end) : null;
    return { day: d.label, start: visit?.start || null, end: visit?.end || null, hours };
  });
  const totalWeeklyHours = scheduleRows.reduce((sum, r) => sum + (r.hours || 0), 0);

  const tasks = authorization?.purchasedTasks || [];

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link
          href={`/admin/clients/${orientation.clientId}/care-plan`}
          className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to care plan
        </Link>
        <PrintButton />
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 max-w-[860px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[var(--border)]">
          <div>
            <h1 className="font-display font-extrabold text-[20px]">
              Attendant Orientation Form — PAS
            </h1>
            <p className="text-[12.5px] text-[var(--muted)] mt-1">
              Personal Assistance Services · required per caregiver-client assignment
            </p>
          </div>
          <span
            className={
              'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ' +
              (orientation.status === 'completed'
                ? 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]'
                : 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]')
            }
          >
            {orientation.status === 'completed' ? 'Completed' : 'Draft'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-5 border-b border-[oklch(93%_0.01_85)]">
          <Field label="Agency Name" value={organization?.name} />
          <Field label="Program Type" value="PAS — Personal Assistance Services" />
          <Field label="Orientation Type" value={TYPE_LABELS[orientation.orientationType]} />
        </div>

        {/* Attendant & individual */}
        <div className="pt-5">
          <div className="font-display font-extrabold text-[14px] mb-3">
            Attendant &amp; Individual Information
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Individual's Name (Client)" value={client?.name} />
            <Field label="HHSC / DADS Individual Number" value={client?.hhscIndividualNumber} />
            <Field label="Attendant's Name" value={caregiver?.name} />
            <Field label="Date of Orientation" value={orientation.orientedOn} />
            <Field label="Method of Orientation" value={METHOD_LABELS[orientation.method]} />
            <Field label="Service Address" value={client?.address} />
          </div>
        </div>

        {/* Tasks */}
        <div className="pt-6">
          <div className="font-display font-extrabold text-[14px] mb-1">Tasks to Be Performed</div>
          <p className="text-[12px] text-[var(--muted)] mb-3">
            {authorization
              ? `From the active service authorization (${authorization.serviceCode} — ${authorization.payer}).`
              : 'No active service authorization on file for this client — add one on the Care Plan page.'}
          </p>
          {tasks.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((task) => (
                <span
                  key={task}
                  className="text-[12px] px-2.5 py-1 rounded-full bg-[oklch(96%_0.006_85)] border border-[var(--border)]"
                >
                  {task}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--muted)]">—</p>
          )}
        </div>

        {/* Schedule */}
        <div className="pt-6">
          <div className="font-display font-extrabold text-[14px] mb-3">Service Schedule</div>
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="grid grid-cols-4 px-4 py-2 text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
              <div>Day</div>
              <div>Start Time</div>
              <div>End Time</div>
              <div>Total Hours</div>
            </div>
            {scheduleRows.map((r) => (
              <div
                key={r.day}
                className="grid grid-cols-4 px-4 py-2 text-[12.5px] border-b border-[oklch(94%_0.008_85)] last:border-none"
              >
                <div className="font-display font-bold">{r.day}</div>
                <div>{r.start || '—'}</div>
                <div>{r.end || '—'}</div>
                <div>{r.hours ? r.hours.toFixed(2) : '—'}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="Total Weekly Hours" value={totalWeeklyHours ? totalWeeklyHours.toFixed(2) : '—'} />
            <Field
              label="Total Authorized Hours per Service Plan"
              value={authorization?.totalHoursPerWeek ? `${authorization.totalHoursPerWeek} / week` : '—'}
            />
          </div>
          {authorization?.totalHoursPerWeek && totalWeeklyHours > Number(authorization.totalHoursPerWeek) && (
            <p className="text-[12.5px] text-[var(--danger)] font-display font-bold mt-3">
              Scheduled hours exceed the authorized hours on the service plan.
            </p>
          )}
        </div>

        {/* Confirmation */}
        <div className="pt-6">
          <div className="font-display font-extrabold text-[14px] mb-2">Attendant Confirmation</div>
          <p className="text-[12.5px] text-[var(--muted)] mb-2">I have received orientation regarding:</p>
          <ul className="text-[12.5px] list-disc pl-5 flex flex-col gap-1">
            <li>My assigned client&rsquo;s service plan and needs</li>
            <li>The tasks I am authorized to perform</li>
            <li>The agency&rsquo;s attendance, documentation, and reporting requirements</li>
            <li>EVV (Electronic Visit Verification) use procedures</li>
            <li>Emergency procedures and reporting abuse, neglect, or exploitation</li>
          </ul>
        </div>

        {/* Signatures */}
        <div className="pt-8 grid grid-cols-3 gap-6">
          {['Attendant Signature', 'Agency Representative', 'Client / Responsible Party'].map((label) => (
            <div key={label}>
              <div className="border-b border-[oklch(70%_0.01_85)] h-8" />
              <div className="text-[11px] text-[var(--muted)] mt-1.5">{label}</div>
              <div className="border-b border-[oklch(70%_0.01_85)] h-7 mt-3" />
              <div className="text-[11px] text-[var(--muted)] mt-1.5">Date</div>
            </div>
          ))}
        </div>

        {orientation.agencyRepName && (
          <p className="text-[12px] text-[var(--muted)] mt-5">
            Orientation delivered by {orientation.agencyRepName}
            {orientation.orientedOn ? ` on ${orientation.orientedOn}` : ''}.
          </p>
        )}
        {orientation.status === 'completed' && orientation.signedVia === 'docusign' && (
          <p className="text-[12px] text-[var(--muted)] mt-1">
            Signed electronically via DocuSign (envelope {orientation.envelopeId}).
          </p>
        )}
        {orientation.notes && <p className="text-[12.5px] mt-3">{orientation.notes}</p>}
      </div>

      {/* Send for e-signature (DocuSign) */}
      {orientation.status !== 'completed' && (
        <SendOrientationForSignature
          orientationId={orientation.id}
          agencyRepDefault={session.name}
          envelopeId={orientation.envelopeId}
          signedVia={orientation.signedVia}
          docusignConnected={docusignCredentials?.status === 'connected'}
          baaOnFile={Boolean(docusignCredentials?.baaOnFile)}
        />
      )}

      {/* Record completion */}
      {orientation.status !== 'completed' && (
        <div className="no-print bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 max-w-[860px]">
          <div className="font-display font-extrabold text-[14.5px] mb-1">Or record it on paper</div>
          <p className="text-[12.5px] text-[var(--muted)] mb-4">
            Fill this in once orientation has actually been delivered and signed on paper.
          </p>
          <form action={completeOrientationAction} className="grid grid-cols-2 gap-4">
            <input type="hidden" name="orientationId" value={orientation.id} />
            <input type="hidden" name="clientId" value={orientation.clientId} />

            <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
              Date of orientation
              <input
                name="orientedOn"
                type="date"
                required
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
              Method
              <select
                name="method"
                defaultValue="in_person"
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              >
                <option value="in_person">In-Person</option>
                <option value="telephone">Telephone</option>
                <option value="video">Video Conference</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
              Agency representative
              <input
                name="agencyRepName"
                defaultValue={session.name}
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
              Notes
              <input
                name="notes"
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <div className="col-span-2">
              <button
                type="submit"
                className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px]"
              >
                Mark orientation complete
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
