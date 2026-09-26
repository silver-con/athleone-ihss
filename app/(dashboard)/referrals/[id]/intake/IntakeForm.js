'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { submitIntakeAction } from '@/actions/referrals';

const initialState = { error: null };

// "4127 Pecan Hollow Dr, San Antonio, TX 78223" -> parts, for prefilling.
const STREET_END = '(?:DR|DRIVE|ST|STREET|AVE|AVENUE|RD|ROAD|LN|LANE|BLVD|CT|COURT|WAY|PKWY|TRL|TRAIL|CIR|CIRCLE|HWY|PL|PLACE|LOOP|PATH|TER|XING)\\.?(?:\\s+(?:APT|UNIT|STE|#)\\s*[\\w-]+)?';
function splitAddress(a) {
  const s = String(a || '').trim();
  const m = /^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(s);
  if (m) return { street: m[1], city: m[2], state: m[3], zip: m[4] };
  // No commas, as payer systems often print it: "1306 EBONY DR MCKINNEY TX 75071"
  const n = new RegExp(`^(.*?\\b${STREET_END})\\s+([A-Za-z .'-]+?)\\s+([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i').exec(s);
  return n ? { street: n[1], city: n[2], state: n[3].toUpperCase(), zip: n[4] } : { street: s };
}

export default function IntakeForm({ referral, careNeedOptions, locations = [] }) {
  const fax = referral.fax || {};
  const fromFax = { ...splitAddress(fax.address), phone: fax.phone || '', medicaidId: fax.medicaidId && /^\d{9}$/.test(fax.medicaidId) ? fax.medicaidId : '', effectiveDates: fax.effectiveDates || '' };
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

      {/* Filled from the fax when the referral came through the Fax Inbox. */}
      <Section title="Client Information">
        <Grid cols={2}>
          <Field label="Full Name" name="clientName" defaultValue={referral.clientName} />
          <Field label="Date of Birth" name="dob" defaultValue={referral.dob} />
          <Field label="Phone" name="phone" placeholder="(   ) ___-____" defaultValue={fromFax.phone} />
          <Field label="Preferred Language" name="language" defaultValue="English" />
          <Field label="Street Address" name="address" full defaultValue={fromFax.street} />
          <Field label="City" name="city" defaultValue={fromFax.city} />
          <Field label="State" name="state" defaultValue={fromFax.state || 'TX'} />
          <Field label="ZIP" name="zip" defaultValue={fromFax.zip} />
          <div className="flex flex-col gap-1.5 col-span-full">
            <span className="text-[11.5px] font-display font-bold text-[oklch(45%_0.02_80)]">Location</span>
            <select
              name="locationId"
              defaultValue=""
              required
              className="border border-[oklch(85%_0.01_85)] rounded-[9px] px-3 py-2.5 text-[13.5px] bg-[oklch(99%_0.004_85)] focus:outline-2 focus:outline-[oklch(80%_0.05_175)] focus:border-[oklch(60%_0.08_175)]"
            >
              <option value="">Pick a location&hellip;</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
            {locations.length === 0 && (
              <span className="text-[11.5px] text-[var(--danger)]">
                This organization has no locations yet — an admin needs to create one before
                intake can be completed.
              </span>
            )}
          </div>
        </Grid>
      </Section>

      <Section title="Payer & Authorization">
        <Grid cols={2}>
          <Field label="Payer Name" name="payerName" defaultValue={referral.payer} />
          <Field label="Medicaid ID (9 digits)" name="memberId" placeholder="Required before EVV visits can be sent" defaultValue={fromFax.medicaidId} />
          <Field label="Authorization Number" name="authNumber" defaultValue={referral.authNumber} />
          <Field label="Authorized Hours / Week" name="authHours" defaultValue={referral.authHours} />
          <Field label="Service Type" name="serviceType" defaultValue={referral.service} />
          <Field label="Effective Dates" name="effectiveDates" defaultValue={fromFax.effectiveDates} />
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
          <Field label="Physician Name" name="physicianName" defaultValue={fax.pcp?.name || ''} />
          <Field label="Phone" name="physicianPhone" placeholder="(   ) ___-____" defaultValue={fax.pcp?.phone || ''} />
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
