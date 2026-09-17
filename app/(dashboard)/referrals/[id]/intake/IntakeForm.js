'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { submitIntakeAction } from '@/actions/referrals';

const initialState = { error: null };

export default function IntakeForm({ referral, careNeedOptions }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(submitIntakeAction, initialState);

  return (
    <form action={formAction} className="pb-10">
      <input type="hidden" name="referralId" value={referral.id} />

      <button
        type="button"
        onClick={() => router.push(`/referrals/${referral.id}`)}
        className="inline-flex items-center gap-1.5 text-[13px] font-display font-bold text-[oklch(45%_0.02_80)] mb-3"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Referral
      </button>

      <h1 className="font-display font-extrabold text-[24px]">Complete Intake — {referral.clientName}</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Referral from {referral.payer} · Authorization {referral.authNumber}
      </p>

      <Section title="Client Information">
        <Grid cols={2}>
          <Field label="Full Name" name="clientName" defaultValue={referral.clientName} />
          <Field label="Date of Birth" name="dob" defaultValue={referral.dob} />
          <Field label="Phone" name="phone" placeholder="(   ) ___-____" />
          <Field label="Preferred Language" name="language" defaultValue="English" />
          <Field label="Street Address" name="address" full />
          <Field label="City, State, ZIP" name="cityStateZip" full />
        </Grid>
      </Section>

      <Section title="Payer & Authorization">
        <Grid cols={2}>
          <Field label="Payer Name" name="payerName" defaultValue={referral.payer} />
          <Field label="Member / Medicaid ID" name="memberId" placeholder="Enter member ID" />
          <Field label="Authorization Number" name="authNumber" defaultValue={referral.authNumber} />
          <Field label="Authorized Hours / Week" name="authHours" defaultValue={referral.authHours} />
          <Field label="Service Type" name="serviceType" defaultValue={referral.service} />
          <Field label="Effective Dates" name="effectiveDates" />
        </Grid>
      </Section>

      <Section title="Emergency Contact">
        <Grid cols={3}>
          <Field label="Name" name="ecName" />
          <Field label="Relationship" name="ecRelationship" />
          <Field label="Phone" name="ecPhone" placeholder="(   ) ___-____" />
        </Grid>
      </Section>

      <Section title="Physician Information">
        <Grid cols={2}>
          <Field label="Physician Name" name="physicianName" />
          <Field label="Phone" name="physicianPhone" placeholder="(   ) ___-____" />
        </Grid>
      </Section>

      <Section title="Care Needs">
        {careNeedOptions.map((task) => (
          <label
            key={task.id}
            className="flex items-center gap-3 py-2.5 border-b border-[oklch(93%_0.01_85)] last:border-none cursor-pointer group"
          >
            <input type="checkbox" name="careNeeds" value={task.id} className="sr-only" />
            <span className="w-[22px] h-[22px] rounded-[7px] border-2 flex items-center justify-center shrink-0 bg-white border-[oklch(82%_0.015_85)] group-has-[:checked]:bg-[var(--accent)] group-has-[:checked]:border-[var(--accent)]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="hidden group-has-[:checked]:block">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className="text-[13.5px]">{task.label}</span>
          </label>
        ))}
      </Section>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input type="checkbox" name="consent" required className="sr-only" />
          <span className="w-[22px] h-[22px] rounded-[7px] border-2 flex items-center justify-center shrink-0 mt-0.5 bg-white border-[oklch(82%_0.015_85)] group-has-[:checked]:bg-[var(--accent)] group-has-[:checked]:border-[var(--accent)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="hidden group-has-[:checked]:block">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span className="text-[13px] leading-relaxed">
            Client or authorized representative has consented to IHSS services and the agency&rsquo;s privacy practices.
          </span>
        </label>

        {state?.error && (
          <div className="text-[13px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5 mt-4">
            {state.error}
          </div>
        )}

        <div className="flex justify-end gap-2.5 mt-6 pt-5 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => router.push('/referrals')}
            className="border border-[oklch(80%_0.02_85)] bg-white rounded-[9px] px-4 py-2.5 font-display font-bold text-[12.5px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="bg-[var(--accent-strong)] text-white rounded-[9px] px-4 py-2.5 font-display font-bold text-[12.5px] disabled:opacity-60"
          >
            {pending ? 'Submitting…' : 'Submit Intake'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
      <div className="font-display font-extrabold text-[14.5px] mb-4">{title}</div>
      {children}
    </div>
  );
}

function Grid({ cols, children }) {
  const colClass = cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return <div className={'grid gap-4 ' + colClass}>{children}</div>;
}

function Field({ label, name, defaultValue, placeholder, full }) {
  return (
    <div className={'flex flex-col gap-1.5 ' + (full ? 'col-span-full' : '')}>
      <span className="text-[11.5px] font-display font-bold text-[oklch(45%_0.02_80)]">{label}</span>
      <input
        name={name}
        className="border border-[oklch(85%_0.01_85)] rounded-[9px] px-3 py-2.5 text-[13.5px] bg-[oklch(99%_0.004_85)] focus:outline-2 focus:outline-[oklch(80%_0.05_175)] focus:border-[oklch(60%_0.08_175)]"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
