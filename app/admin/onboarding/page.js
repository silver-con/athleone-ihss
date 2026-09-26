import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { getOrganization, getEvvCredentials } from '@/lib/queries';
import {
  updateProviderInfoAction,
  updateProviderEnrollmentAction,
  updateBaaSignedAction,
} from '@/actions/tenant-onboarding';
import { US_STATES } from '@/lib/data';

// Tenant onboarding go-live checklist — architecture spec §5 / §7 Phase 3,
// scoped to just the wizard/checklist: no platform/vendor-ops role, no
// incumbent-vendor (Vesta) migration tooling here yet, both stay in the
// backlog. This is the landing page a brand-new agency signs up into
// (/signup redirects here), and a page any agency admin can revisit any
// time to see what's left before they're EVV-live.
//
// Every "done" state below reads a real column — nothing here is
// hard-coded true. The two attestation checkboxes (provider enrollment,
// BAA) are self-reported by the agency's own admin, same convention as
// organization_docusign_credentials.baa_on_file elsewhere in this app —
// Hearth's software has no way to verify either claim itself.

function StepCard({ n, title, done, badge, children }) {
  return (
    <div
      className={
        'rounded-2xl border p-5 ' +
        (done
          ? 'bg-[var(--success-soft)] border-[oklch(85%_0.05_150)]'
          : 'bg-[var(--surface)] border-[var(--border)]')
      }
    >
      <div className="flex items-start gap-3.5">
        <div
          className={
            'w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0 font-display font-extrabold text-[13px] mt-0.5 ' +
            (done ? 'bg-[var(--success)] text-white' : 'bg-[oklch(93%_0.008_85)] text-[var(--muted)]')
          }
        >
          {done ? '✓' : n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-display font-extrabold text-[15px]">{title}</div>
            {badge}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export default async function AdminOnboardingPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/admin');

  const params = await searchParams;
  const [organization, evvCredentials] = await Promise.all([
    getOrganization(session.organizationId),
    getEvvCredentials(session.organizationId),
  ]);

  const providerInfoDone = Boolean(
    organization?.medicaidProviderNumber && organization?.npi && organization?.stateLicenseNumber
  );
  const enrollmentDone = Boolean(organization?.providerEnrollmentAttested);
  const baaDone = Boolean(organization?.baaSigned);
  const credentialsConfigured = Boolean(evvCredentials);
  const certificationPassed = evvCredentials?.status === 'passed' || evvCredentials?.status === 'live';
  const evvLive = evvCredentials?.status === 'live';

  const steps = [true, providerInfoDone, enrollmentDone, baaDone, credentialsConfigured, certificationPassed, evvLive];
  const doneCount = steps.filter(Boolean).length;

  return (
    <div className="max-w-[820px]">
      <h1 className="font-display font-extrabold text-[24px]">Setup &amp; go-live checklist</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Everything {organization?.name || 'your agency'} needs before EVV transmission goes live — most of
        this can be finished whenever you&rsquo;re ready, and nothing here blocks you from using the rest
        of Athleone in the meantime.
      </p>

      {params?.justCreated && (
        <div className="bg-[var(--success-soft)] border border-[oklch(85%_0.05_150)] rounded-xl px-3.5 py-2.5 text-[12.5px] text-[var(--success)] font-display font-bold mt-4">
          Your agency&rsquo;s account is set up — welcome to Athleone.
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 mt-5">
        <div className="flex items-center justify-between text-[12.5px] mb-2">
          <span className="font-display font-bold">Progress</span>
          <span className="text-[var(--muted)]">{doneCount} of {steps.length}</span>
        </div>
        <div className="h-2 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden">
          <div
            className={'h-full rounded-full ' + (doneCount === steps.length ? 'bg-[var(--success)]' : 'bg-[var(--accent-strong)]')}
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 mt-5">
        <StepCard n={1} title="Agency account created" done={true}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1">
            {organization?.name} &middot; status: {organization?.status}
          </p>
        </StepCard>

        <StepCard n={2} title="Provider info on file" done={providerInfoDone}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-3">
            Your state, Medicaid provider number, NPI, and state home-care license number &mdash; recorded
            here, not verified by Athleone.
          </p>
          <form action={updateProviderInfoAction} className="grid grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-[11.5px] font-display font-bold text-[var(--muted)]">
              State
              <select
                name="state"
                defaultValue={organization?.state || 'TX'}
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              >
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-display font-bold text-[var(--muted)]">
              Medicaid provider #
              <input
                name="medicaidProviderNumber"
                defaultValue={organization?.medicaidProviderNumber || ''}
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-display font-bold text-[var(--muted)]">
              NPI
              <input
                name="npi"
                defaultValue={organization?.npi || ''}
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-display font-bold text-[var(--muted)]">
              State license #
              <input
                name="stateLicenseNumber"
                defaultValue={organization?.stateLicenseNumber || ''}
                className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
              />
            </label>
            <div className="col-span-4">
              <button type="submit" className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[10px]">
                Save provider info
              </button>
            </div>
          </form>
        </StepCard>

        <StepCard n={3} title="HHAeXchange / TMHP provider enrollment" done={enrollmentDone}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-3">
            Your agency completes its own provider enrollment and attestation directly with HHAeXchange/TMHP
            &mdash; Athleone can&rsquo;t do this step on your behalf, since credentials are tied to your own
            Medicaid provider identity.
          </p>
          <form action={updateProviderEnrollmentAction} className="flex flex-col gap-3">
            <label className="flex items-start gap-2.5 bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-xl px-3.5 py-3">
              <input
                type="checkbox"
                name="providerEnrollmentAttested"
                defaultChecked={enrollmentDone}
                className="mt-0.5"
              />
              <span className="text-[12px] text-[oklch(42%_0.1_75)]">
                <strong className="font-display font-bold">We&rsquo;ve completed our HHAeXchange/TMHP provider enrollment and attestation.</strong>{' '}
                Checking this doesn&rsquo;t submit anything to the state &mdash; it just tracks that this
                step is done on your end.
              </span>
            </label>
            <button type="submit" className="self-start bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[10px]">
              Save
            </button>
          </form>
        </StepCard>

        <StepCard n={4} title="Business Associate Agreement with Athleone" done={baaDone}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-3">
            A signed BAA between your agency and Athleone, required before any client PHI enters the system
            (Athleone is your Business Associate under HIPAA). This is separate from DocuSign&rsquo;s own BAA
            on the E-Signature settings page, which only affects documents sent through DocuSign.
          </p>
          <form action={updateBaaSignedAction} className="flex flex-col gap-3">
            <label className="flex items-start gap-2.5 bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-xl px-3.5 py-3">
              <input
                type="checkbox"
                name="baaSigned"
                defaultChecked={baaDone}
                className="mt-0.5"
              />
              <span className="text-[12px] text-[oklch(42%_0.1_75)]">
                <strong className="font-display font-bold">A signed Business Associate Agreement with Athleone is on file.</strong>{' '}
                Only check this once that&rsquo;s actually true.
              </span>
            </label>
            <button type="submit" className="self-start bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[10px]">
              Save
            </button>
          </form>
        </StepCard>

        <StepCard
          n={5}
          title="HHAeXchange EVV credentials configured"
          done={credentialsConfigured}
          badge={
            <Link href="/admin/evv" className="text-[11px] font-display font-bold text-[var(--accent)]">
              Manage on EVV Compliance →
            </Link>
          }
        >
          <p className="text-[12.5px] text-[var(--muted)] mt-1">
            {credentialsConfigured
              ? `Configured (status: ${evvCredentials.status}).`
              : 'Not configured yet — requires HHAeXchange implementation credentials, which your agency requests naming Athleone as your EVV vendor.'}
          </p>
        </StepCard>

        <StepCard n={6} title="Sandbox certification passed" done={certificationPassed}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1">
            The 10 mandatory scenarios plus 2 error-handling cases in HHAeXchange&rsquo;s Implementation
            environment, run against your real credentials.
          </p>
        </StepCard>

        <StepCard n={7} title="Live in production" done={evvLive}>
          <p className="text-[12.5px] text-[var(--muted)] mt-1">
            Once live, visit billing generation switches from local clock-out to waiting on state
            confirmation for every visit &mdash; see the Finance page for details.
          </p>
        </StepCard>
      </div>
    </div>
  );
}
