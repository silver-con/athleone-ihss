'use client';

import { useActionState, useState } from 'react';
import { submitApplicationAction } from '@/actions/onboarding';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const field =
  'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal w-full';
const labelClass = 'flex flex-col gap-1.5 text-[12px] font-display font-bold';

function YesNo({ name, label, required }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[oklch(94%_0.008_85)] last:border-none">
      <span className="text-[12.5px]">{label}</span>
      <div className="flex gap-3 shrink-0">
        {['yes', 'no'].map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-[12.5px]">
            <input type="radio" name={name} value={v} required={required} />
            {v === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <div className="font-display font-extrabold text-[13.5px] mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function ApplicationForm({ defaults }) {
  const [state, formAction, pending] = useActionState(submitApplicationAction, { error: null });
  const [hasRecord, setHasRecord] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state?.error && (
        <div className="bg-[oklch(93%_0.06_25)] text-[var(--danger)] rounded-xl px-3.5 py-2.5 text-[12.5px] font-display font-bold">
          {state.error}
        </div>
      )}

      <Section title="Your details">
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            Full name
            <input name="fullName" required defaultValue={defaults?.name || ''} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Date of birth
              <input name="dateOfBirth" type="date" className={field} />
            </label>
            <label className={labelClass}>
              Phone
              <input name="phone" defaultValue={defaults?.phone || ''} className={field} />
            </label>
          </div>
          <label className={labelClass}>
            Email
            <input name="email" type="email" defaultValue={defaults?.email || ''} className={field} />
          </label>
          <label className={labelClass}>
            Street address
            <input name="address" className={field} />
          </label>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <label className={labelClass}>
              City
              <input name="city" className={field} />
            </label>
            <label className={labelClass}>
              State
              <input name="state" defaultValue="TX" className={field} />
            </label>
            <label className={labelClass}>
              ZIP
              <input name="zip" className={field} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Position">
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            Position applying for
            <select name="positionApplied" defaultValue="Personal Care Attendant (PCA)" className={field}>
              <option>Personal Care Attendant (PCA)</option>
              <option>Home Care Aide</option>
              <option>Certified Nursing Assistant</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Full-time / Part-time / PRN
              <select name="employmentType" defaultValue="Full-time" className={field}>
                <option>Full-time</option>
                <option>Part-time</option>
                <option>PRN</option>
              </select>
            </label>
            <label className={labelClass}>
              Available to start
              <input name="availableStart" type="date" className={field} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Eligibility">
        <YesNo name="workAuthorized" label="Legally authorized to work in the U.S.?" required />
        <YesNo name="workedHereBefore" label="Have you worked for this agency before?" required />
        <YesNo name="reliableTransport" label="Do you have reliable transportation?" required />
        <YesNo name="driversLicense" label="Valid driver's license and auto insurance?" required />
        <div className="pt-1">
          <div className="flex items-center justify-between gap-3 py-2">
            <span className="text-[12.5px]">
              Ever convicted of a criminal offense (excluding minor traffic violations)?
            </span>
            <div className="flex gap-3 shrink-0">
              {['yes', 'no'].map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-[12.5px]">
                  <input
                    type="radio"
                    name="criminalDisclosure"
                    value={v}
                    required
                    onChange={() => setHasRecord(v === 'yes')}
                  />
                  {v === 'yes' ? 'Yes' : 'No'}
                </label>
              ))}
            </div>
          </div>
          {hasRecord && (
            <label className={labelClass}>
              Please explain
              <textarea name="criminalExplanation" rows={2} className={field} />
            </label>
          )}
        </div>
      </Section>

      <Section title="Experience">
        <YesNo name="hasPasExperience" label="Experience providing personal care?" required />
        <label className={labelClass + ' mt-3'}>
          Years of experience
          <input name="experienceYears" className={field} />
        </label>

        {[1, 2].map((i) => (
          <div key={i} className="mt-4">
            <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-2">
              Employer #{i} {i === 2 && '(optional)'}
            </div>
            <div className="flex flex-col gap-3">
              <input name={`employer${i}Company`} placeholder="Company name" className={field} />
              <div className="grid grid-cols-2 gap-3">
                <input name={`employer${i}Position`} placeholder="Position" className={field} />
                <input name={`employer${i}Dates`} placeholder="Dates employed" className={field} />
              </div>
              <input name={`employer${i}Supervisor`} placeholder="Supervisor name & phone" className={field} />
              <input name={`employer${i}Reason`} placeholder="Reason for leaving" className={field} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="References — two, not family">
        {[1, 2].map((i) => (
          <div key={i} className="grid grid-cols-2 gap-3 mb-3 last:mb-0">
            <input name={`reference${i}Name`} placeholder={`Reference ${i} name`} required className={field} />
            <input name={`reference${i}Phone`} placeholder="Phone number" required className={field} />
          </div>
        ))}
      </Section>

      <Section title="Days available">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" name={`day_${d}`} />
              {d.slice(0, 3)}
            </label>
          ))}
        </div>
      </Section>

      <label className="flex items-start gap-2.5 text-[12.5px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
        <input type="checkbox" name="certifiedTrue" className="mt-0.5" />
        <span>
          I confirm the information above is accurate and complete to the best of my knowledge.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="bg-[var(--accent-strong)] text-white rounded-[12px] px-5 py-3 text-[13.5px] font-display font-bold disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  );
}
