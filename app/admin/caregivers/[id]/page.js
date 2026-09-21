import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getCaregiver,
  getCaregiverDocuments,
  getLatestChecks,
  getCourses,
  getCompletionsForCaregiver,
  getClients,
  getOnboardingState,
  DOC_TYPES,
  CHECK_TYPES,
} from '@/lib/queries';
import { recordCheckAction, updateDocumentAction } from '@/actions/caregiver-hr';
import ActivateCaregiverButton from '@/components/admin/ActivateCaregiverButton';

const DOC_STATUS_LABEL = {
  not_started: 'Not started',
  sent: 'Sent for signature',
  signed: 'Signed',
  declined: 'Declined',
  uploaded: 'Uploaded',
};

const DOC_STATUS_STYLE = {
  not_started: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
  sent: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]',
  signed: 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]',
  uploaded: 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]',
  declined: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]',
};

// A check is overdue once its next-due date has passed, and "due soon"
// inside 30 days — the annual re-check is exactly what lapses silently
// on paper, so it needs to be visible before it expires, not after.
function dueState(nextDueOn) {
  if (!nextDueOn) return null;
  const days = Math.floor((new Date(nextDueOn) - new Date()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { label: `Overdue by ${Math.abs(days)}d`, tone: 'danger' };
  if (days <= 30) return { label: `Due in ${days}d`, tone: 'warn' };
  return { label: `Due ${nextDueOn}`, tone: 'ok' };
}

const inputClass =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';

export default async function CaregiverRecordPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const caregiver = await getCaregiver(session.organizationId, id, session.locationId);

  if (!caregiver) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Caregiver not found.{' '}
        <Link href="/admin/caregivers" className="text-[var(--accent)] font-display font-bold">
          Back to caregivers
        </Link>
      </div>
    );
  }

  const [documents, checks, courses, completions, clients, onboarding] = await Promise.all([
    getCaregiverDocuments(session.organizationId, id),
    getLatestChecks(session.organizationId, id),
    getCourses(session.organizationId),
    getCompletionsForCaregiver(session.organizationId, id),
    getClients(session.organizationId, session.locationId),
    getOnboardingState(session.organizationId, id),
  ]);

  const application = onboarding.application;
  const inOnboarding = ['applicant', 'onboarding'].includes(caregiver.status);
  const blockers = [
    !onboarding.applicationSubmitted && 'application',
    !onboarding.packetSigned && 'signed documents',
    !onboarding.trainingComplete && 'training',
    !onboarding.checksCurrent && 'background checks',
    !onboarding.i9OnFile && 'Form I-9',
  ].filter(Boolean);

  const docByType = Object.fromEntries(documents.map((d) => [d.docType, d]));
  const checkByType = Object.fromEntries(checks.map((c) => [c.checkType, c]));
  const doneCourseIds = new Set(completions.map((c) => c.courseId));
  const initialCourses = courses.filter((c) => c.courseType === 'initial');
  const trainingDone = initialCourses.filter((c) => doneCourseIds.has(c.id)).length;
  const hoursTotal = completions.reduce((sum, c) => sum + c.hoursCredited, 0);
  const caseload = clients.filter((c) => c.assignedCaregiverId === caregiver.id);

  const docsComplete = DOC_TYPES.filter((t) =>
    ['signed', 'uploaded'].includes(docByType[t.key]?.status)
  ).length;
  const checksOverdue = CHECK_TYPES.filter((t) => {
    const s = dueState(checkByType[t.key]?.nextDueOn);
    return s?.tone === 'danger' || !checkByType[t.key];
  }).length;

  return (
    <div>
      <Link
        href="/admin/caregivers"
        className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] mb-3"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to caregivers
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">{caregiver.name}</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">
            {caregiver.role} · {caregiver.phone} · {caseload.length} client
            {caseload.length === 1 ? '' : 's'} assigned
          </p>
        </div>
        <span className="text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
          {caregiver.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 mt-5 text-[12.5px]">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-2.5">
          <span className="font-display font-extrabold text-[15px]">{docsComplete}</span>
          <span className="text-[var(--muted)]"> / {DOC_TYPES.length} documents on file</span>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-2.5">
          <span
            className={
              'font-display font-extrabold text-[15px] ' + (checksOverdue > 0 ? 'text-[var(--danger)]' : '')
            }
          >
            {checksOverdue}
          </span>
          <span className="text-[var(--muted)]"> checks missing or overdue</span>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-2.5">
          <span className="font-display font-extrabold text-[15px]">
            {trainingDone} / {initialCourses.length}
          </span>
          <span className="text-[var(--muted)]"> onboarding training · {hoursTotal.toFixed(1)} hrs total</span>
        </div>
      </div>

      {/* Onboarding status — only while the caregiver is still pre-hire.
          Activation is gated on the items that legally gate a first shift,
          not just on the caregiver finishing her own paperwork. */}
      {inOnboarding && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
          <div className="font-display font-extrabold text-[14.5px]">Onboarding</div>
          <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-4">
            {onboarding.caregiverStepsComplete
              ? 'This caregiver has finished everything on their side.'
              : 'Waiting on the caregiver to finish their own steps.'}
          </p>

          <div className="grid grid-cols-5 gap-3 mb-5">
            {[
              ['Application', onboarding.applicationSubmitted],
              ['Documents signed', onboarding.packetSigned],
              ['Training', onboarding.trainingComplete],
              ['Background checks', onboarding.checksCurrent],
              ['Form I-9', onboarding.i9OnFile],
            ].map(([label, done]) => (
              <div key={label} className="text-[12px]">
                <div
                  className={
                    'font-display font-bold ' + (done ? 'text-[var(--success)]' : 'text-[var(--muted)]')
                  }
                >
                  {done ? '✓ Done' : '○ Pending'}
                </div>
                <div className="text-[var(--muted)] mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          <ActivateCaregiverButton
            caregiverId={caregiver.id}
            ready={onboarding.readyToActivate}
            blockers={blockers}
          />
        </div>
      )}

      {/* Submitted application */}
      {application && (
        <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
          <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
            Employment application
            <span className="font-body font-normal text-[12px] text-[var(--muted)] ml-2">
              submitted {new Date(application.submittedAt).toLocaleDateString('en-US')}
            </span>
          </summary>

          <div className="grid grid-cols-3 gap-4 mt-5">
            {[
              ['Position', application.positionApplied],
              ['Employment type', application.employmentType],
              ['Available from', application.availableStart],
              ['Phone', application.phone],
              ['Email', application.email],
              [
                'Address',
                [application.address, application.city, application.state, application.zip]
                  .filter(Boolean)
                  .join(', '),
              ],
              ['PAS experience', application.hasPasExperience ? `Yes · ${application.experienceYears || '—'} yrs` : 'No'],
              ['Work authorized', application.workAuthorized ? 'Yes' : 'No'],
              ['Transport / licence', `${application.reliableTransport ? 'Transport' : 'No transport'} · ${application.driversLicense ? 'licensed' : 'no licence'}`],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)]">
                  {label}
                </div>
                <div className="text-[13px] mt-0.5">{value || '—'}</div>
              </div>
            ))}
          </div>

          {application.criminalDisclosure && (
            <div className="mt-4 bg-[oklch(94%_0.05_85)] rounded-xl px-3.5 py-2.5">
              <div className="text-[12px] font-display font-bold text-[oklch(45%_0.1_75)]">
                Disclosed a criminal conviction — review alongside the DPS check
              </div>
              {application.criminalExplanation && (
                <p className="text-[12.5px] mt-1">{application.criminalExplanation}</p>
              )}
            </div>
          )}

          {application.daysAvailable.length > 0 && (
            <div className="mt-4">
              <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
                Days available
              </div>
              <div className="flex flex-wrap gap-1.5">
                {application.daysAvailable.map((d) => (
                  <span
                    key={d}
                    className="text-[12px] px-2.5 py-1 rounded-full bg-[oklch(96%_0.006_85)] border border-[var(--border)]"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {application.employers.length > 0 && (
            <div className="mt-4">
              <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
                Work history
              </div>
              {application.employers.map((e, i) => (
                <div key={i} className="text-[12.5px] mb-1.5 last:mb-0">
                  <span className="font-display font-bold">{e.company}</span>
                  {e.position ? ` — ${e.position}` : ''}
                  {e.dates ? ` · ${e.dates}` : ''}
                  {e.reasonForLeaving ? ` · left: ${e.reasonForLeaving}` : ''}
                </div>
              ))}
            </div>
          )}

          {application.referencesList.length > 0 && (
            <div className="mt-4">
              <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">
                References
              </div>
              {application.referencesList.map((r, i) => (
                <div key={i} className="text-[12.5px]">
                  {r.name} · {r.phone}
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      {/* Background checks */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="font-display font-extrabold text-[14.5px]">Background checks</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-4">
          Texas requires all three before hire and annually thereafter for unlicensed staff with
          face-to-face client contact. These are manual lookups on the HHSC site — record the result here.
        </p>

        <div className="flex flex-col gap-2.5">
          {CHECK_TYPES.map((t) => {
            const check = checkByType[t.key];
            const state = dueState(check?.nextDueOn);
            return (
              <div
                key={t.key}
                className="flex items-center justify-between gap-3 border-b border-[oklch(94%_0.008_85)] last:border-none pb-2.5 last:pb-0"
              >
                <div>
                  <div className="font-display font-bold text-[13.5px]">{t.label}</div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {check
                      ? `Completed ${check.completedOn}${check.performedBy ? ` by ${check.performedBy}` : ''}`
                      : 'Never recorded'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {check?.result === 'flagged' && (
                    <span className="text-[11px] font-display font-bold uppercase px-2 py-1 rounded-full bg-[oklch(93%_0.06_25)] text-[var(--danger)]">
                      Flagged
                    </span>
                  )}
                  <span
                    className={
                      'text-[11.5px] font-display font-bold ' +
                      (!check || state?.tone === 'danger'
                        ? 'text-[var(--danger)]'
                        : state?.tone === 'warn'
                          ? 'text-[oklch(45%_0.11_55)]'
                          : 'text-[var(--muted)]')
                    }
                  >
                    {check ? state?.label || '—' : 'Not on file'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-4 border-t border-[oklch(93%_0.01_85)] pt-4">
          <summary className="text-[12.5px] font-display font-bold text-[var(--accent)] cursor-pointer">
            + Record a check
          </summary>
          <form action={recordCheckAction} className="grid grid-cols-3 gap-3 mt-4">
            <input type="hidden" name="caregiverId" value={caregiver.id} />
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Check
              <select name="checkType" className={inputClass} defaultValue="dps_criminal">
                {CHECK_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Completed on
              <input name="completedOn" type="date" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Next due (defaults to +1 year)
              <input name="nextDueOn" type="date" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Result
              <select name="result" className={inputClass} defaultValue="clear">
                <option value="clear">Clear</option>
                <option value="flagged">Flagged — review</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Performed by
              <input name="performedBy" defaultValue={session.name} className={inputClass} />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] w-full"
              >
                Record check
              </button>
            </div>
          </form>
        </details>
      </div>

      {/* Documents */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="font-display font-extrabold text-[14.5px]">Onboarding documents</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-4">
          The onboarding packet (confidentiality, handbook, Hepatitis B) can be signed electronically once
          DocuSign is connected — see each row below. Form I-9 is tracked here but completed on paper —
          Section 2 requires physically examining original documents.
        </p>

        <div className="flex flex-col gap-2.5">
          {DOC_TYPES.map((t) => {
            const doc = docByType[t.key];
            const status = doc?.status || 'not_started';
            return (
              <div
                key={t.key}
                className="flex items-center justify-between gap-3 border-b border-[oklch(94%_0.008_85)] last:border-none pb-2.5 last:pb-0"
              >
                <div>
                  <div className="font-display font-bold text-[13.5px]">{t.label}</div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {doc?.completedOn ? `Completed ${doc.completedOn}` : 'No date recorded'}
                    {doc?.expiresOn ? ` · expires ${doc.expiresOn}` : ''}
                    {doc?.signedVia === 'docusign' ? ' · via DocuSign' : ''}
                  </div>
                </div>
                <span
                  className={
                    'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ' +
                    (DOC_STATUS_STYLE[status] || DOC_STATUS_STYLE.not_started)
                  }
                >
                  {DOC_STATUS_LABEL[status]}
                </span>
              </div>
            );
          })}
        </div>

        <details className="mt-4 border-t border-[oklch(93%_0.01_85)] pt-4">
          <summary className="text-[12.5px] font-display font-bold text-[var(--accent)] cursor-pointer">
            + Update a document
          </summary>
          <form action={updateDocumentAction} className="grid grid-cols-3 gap-3 mt-4">
            <input type="hidden" name="caregiverId" value={caregiver.id} />
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Document
              <select name="docType" className={inputClass} defaultValue="confidentiality">
                {DOC_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Status
              <select name="status" className={inputClass} defaultValue="signed">
                <option value="not_started">Not started</option>
                <option value="sent">Sent for signature</option>
                <option value="signed">Signed</option>
                <option value="uploaded">Uploaded</option>
                <option value="declined">Declined</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Completed on
              <input name="completedOn" type="date" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Expires on (if any)
              <input name="expiresOn" type="date" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-display font-bold">
              Notes
              <input name="notes" className={inputClass} />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2.5 rounded-[10px] w-full"
              >
                Save
              </button>
            </div>
          </form>
        </details>
      </div>

      {/* Training */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-display font-extrabold text-[14.5px]">Training</div>
          <Link href="/admin/training" className="text-[12px] font-display font-bold text-[var(--accent)]">
            Manage courses →
          </Link>
        </div>

        {courses.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)] mt-3">
            No courses set up yet — add them from the Training page.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5 mt-4">
            {courses.map((course) => {
              const completion = completions.find((c) => c.courseId === course.id);
              return (
                <div
                  key={course.id}
                  className="flex items-center justify-between gap-3 border-b border-[oklch(94%_0.008_85)] last:border-none pb-2.5 last:pb-0"
                >
                  <div>
                    <div className="font-display font-bold text-[13.5px]">{course.title}</div>
                    <div className="text-[12px] text-[var(--muted)]">
                      {course.courseType === 'annual' ? 'Annual' : 'Onboarding'} · {course.hours} hrs
                    </div>
                  </div>
                  <span
                    className={
                      'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ' +
                      (completion
                        ? 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]'
                        : 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]')
                    }
                  >
                    {completion ? 'Completed' : 'Not started'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
