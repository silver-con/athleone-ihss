import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOnboardingState, getCaregiver, getDocusignCredentials } from '@/lib/queries';
import SignPacketButton from '@/components/caregiver/SignPacketButton';

function StepRow({ n, title, detail, done, href, cta, children }) {
  return (
    <div
      className={
        'rounded-2xl border p-4 ' +
        (done
          ? 'bg-[var(--success-soft)] border-[oklch(85%_0.05_150)]'
          : 'bg-[var(--surface)] border-[var(--border)]')
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            'w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 font-display font-extrabold text-[12px] ' +
            (done ? 'bg-[var(--success)] text-white' : 'bg-[oklch(93%_0.008_85)] text-[var(--muted)]')
          }
        >
          {done ? '✓' : n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-extrabold text-[14.5px]">{title}</div>
          <div className="text-[12.5px] text-[var(--muted)] mt-0.5">{detail}</div>
          {!done && href && (
            <Link
              href={href}
              className="inline-block mt-3 bg-[var(--accent-strong)] text-white rounded-[10px] px-4 py-2 text-[12.5px] font-display font-bold"
            >
              {cta}
            </Link>
          )}
          {!done && children}
        </div>
      </div>
    </div>
  );
}

export default async function CaregiverOnboardingPage({ searchParams }) {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const params = await searchParams;
  const [state, me, docusignCredentials] = await Promise.all([
    getOnboardingState(session.organizationId, session.caregiverId),
    getCaregiver(session.organizationId, session.caregiverId),
    getDocusignCredentials(session.organizationId),
  ]);
  const canEsign = docusignCredentials?.status === 'connected';

  const steps = [state.applicationSubmitted, state.packetSigned, state.trainingComplete];
  const doneCount = steps.filter(Boolean).length;

  return (
    <div>
      <h2 className="font-display font-extrabold text-[19px]">Welcome{me?.name ? `, ${me.name.split(' ')[0]}` : ''}</h2>
      <p className="text-[12.5px] text-[var(--muted)] mt-1">
        Three things to finish before your first shift. You can stop and come back any time.
      </p>

      {params?.submitted && (
        <div className="bg-[var(--success-soft)] border border-[oklch(85%_0.05_150)] rounded-xl px-3.5 py-2.5 text-[12.5px] text-[var(--success)] font-display font-bold mt-4">
          Application submitted — thank you.
        </div>
      )}
      {params?.esignError && (
        <div className="bg-[oklch(93%_0.06_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5 text-[12.5px] text-[var(--danger)] font-display font-bold mt-4">
          Something went wrong opening the signing page. Please try again.
          {process.env.NODE_ENV !== 'production' && params?.esignDetail && (
            <div className="font-body font-normal text-[11px] mt-1.5 opacity-80 whitespace-pre-wrap break-words">
              Dev detail: {decodeURIComponent(params.esignDetail)}
            </div>
          )}
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 mt-4">
        <div className="flex items-center justify-between text-[12.5px] mb-2">
          <span className="font-display font-bold">Your progress</span>
          <span className="text-[var(--muted)]">{doneCount} of 3</span>
        </div>
        <div className="h-2 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden">
          <div
            className={
              'h-full rounded-full ' +
              (doneCount === 3 ? 'bg-[var(--success)]' : 'bg-[var(--accent-strong)]')
            }
            style={{ width: `${(doneCount / 3) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 mt-4">
        <StepRow
          n={1}
          title="Complete your application"
          detail={
            state.applicationSubmitted
              ? 'Submitted — the office has it.'
              : 'Your details, work history and two references.'
          }
          done={state.applicationSubmitted}
          href="/caregiver/onboarding/application"
          cta="Start application"
        />
        <StepRow
          n={2}
          title="Sign your documents"
          detail={
            state.packetSigned
              ? 'All signed.'
              : canEsign
                ? 'Confidentiality agreement, employee handbook, and your Hepatitis B choice — sign them online in a couple of minutes.'
                : 'Confidentiality agreement, employee handbook, and your Hepatitis B choice. The office will send these to you to sign.'
          }
          done={state.packetSigned}
        >
          {canEsign && <SignPacketButton />}
        </StepRow>
        <StepRow
          n={3}
          title="Complete your training"
          detail={
            state.trainingComplete
              ? 'All courses finished.'
              : `${state.trainingProgress.done} of ${state.trainingProgress.total} courses done.`
          }
          done={state.trainingComplete}
          href="/caregiver/training"
          cta="Go to training"
        />
      </div>

      {state.caregiverStepsComplete && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 mt-4">
          <div className="font-display font-extrabold text-[14px]">That&rsquo;s everything on your side</div>
          <p className="text-[12.5px] text-[var(--muted)] mt-1">
            The office has a few checks of their own to finish before your first shift is scheduled.
            They&rsquo;ll be in touch.
          </p>
        </div>
      )}
    </div>
  );
}
