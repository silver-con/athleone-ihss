'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createReferralAction } from '@/actions/referrals';

const initialState = { error: null };

function todayFormatted() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export default function NewReferralForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createReferralAction, initialState);

  return (
    <form action={formAction} className="pb-10">
      <button
        type="button"
        onClick={() => router.push('/referrals')}
        className="inline-flex items-center gap-1.5 text-[13px] font-display font-bold text-[oklch(45%_0.02_80)] mb-3"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Referrals
      </button>

      <h1 className="font-display font-extrabold text-[24px] tracking-tight">New Referral</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[560px]">
        Enter a referral by hand — from a fax, a phone call, or a payer portal — the same way one
        would normally arrive. This creates the referral only; intake (address, care needs,
        consent) still happens as its own step from the Referrals queue.
      </p>

      <Section title="Payer & Referral">
        <Grid cols={2}>
          <Field label="Payer / Referring Source" name="payer" placeholder="e.g. Molina Healthcare" />
          <Field label="Date Received" name="receivedDate" defaultValue={todayFormatted()} />
        </Grid>
      </Section>

      <Section title="Client">
        <Grid cols={2}>
          <Field label="Full Name" name="clientName" placeholder="e.g. Eleanor Whitfield" />
          <Field label="Date of Birth" name="dob" placeholder="MM/DD/YYYY" />
        </Grid>
      </Section>

      <Section title="Authorization">
        <Grid cols={2}>
          <Field label="Service Type" name="service" placeholder="e.g. Personal Care Services" />
          <Field label="Authorized Hours" name="authHours" placeholder="e.g. 15 hrs/wk" />
          <Field label="Authorization Number" name="authNumber" placeholder="e.g. MHC-IHSS-88214" full={false} />
          <Field label="Reason / Diagnosis" name="diagnosis" placeholder="e.g. Mobility impairment; assistance with ADLs" full />
        </Grid>
      </Section>

      {state?.error && (
        <div className="text-[13px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5 mt-4">
          {state.error}
        </div>
      )}

      <div className="flex justify-end gap-2.5 mt-6">
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
          {pending ? 'Creating…' : 'Create Referral'}
        </button>
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
        required
        className="border border-[oklch(85%_0.01_85)] rounded-[9px] px-3 py-2.5 text-[13.5px] bg-[oklch(99%_0.004_85)] focus:outline-2 focus:outline-[oklch(80%_0.05_175)] focus:border-[oklch(60%_0.08_175)]"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
