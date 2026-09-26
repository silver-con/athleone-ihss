import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferral } from '@/lib/queries';

export default async function FaxPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  const referral = await getReferral(session.organizationId, id);

  if (!referral || !referral.fax) {
    notFound();
  }

  const fax = referral.fax;

  return (
    <div className="min-h-screen bg-[oklch(93.5%_0.012_250)] py-10 px-4">
      <div className="max-w-[816px] mx-auto mb-4">
        <Link
          href={`/referrals/${referral.id}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-display font-bold text-[oklch(35%_0.02_80)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to Referral
        </Link>
      </div>

      <div className="max-w-[816px] mx-auto bg-[oklch(99%_0.004_85)] shadow-[0_20px_50px_-14px_oklch(30%_0.03_250_/_0.3)] text-[oklch(20%_0.02_80)]">
        <div className="font-mono text-[11px] tracking-wide text-[oklch(38%_0.02_80)] bg-[oklch(95%_0.008_85)] border-b border-dashed border-[oklch(78%_0.01_85)] px-12 py-2.5 flex justify-between">
          <span>{fax.transmittedAt}</span>
          <span>MOLINA HEALTHCARE FAX {fax.faxNumber}</span>
          <span>PAGE 001</span>
        </div>

        <div className="px-12 pt-8 pb-14">
          <div className="flex justify-between items-start border-b-[3px] border-[var(--accent-strong)] pb-4">
            <div>
              <div className="font-display font-extrabold text-[24px] tracking-tight text-[oklch(30%_0.06_175)]">
                MOLINA HEALTHCARE
              </div>
              <div className="text-[12px] text-[var(--muted)] mt-0.5">Community Care Coordination</div>
            </div>
            <div className="text-right text-[11px] text-[var(--muted)] leading-relaxed">
              {fax.payerAddress.map((line) => (
                <div key={line}>{line}</div>
              ))}
              Fax: {fax.faxNumber} &nbsp;·&nbsp; Tel: {fax.payerPhone}
            </div>
          </div>

          <div className="font-display font-extrabold text-[15px] uppercase tracking-wide text-[oklch(38%_0.02_80)] mt-5 mb-3">
            Fax Cover Sheet
          </div>
          <div className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px] mb-1.5">
            <div className="font-bold text-[oklch(45%_0.02_80)]">To:</div><div>{fax.toLine}</div>
            <div className="font-bold text-[oklch(45%_0.02_80)]">From:</div><div>{fax.fromLine}</div>
            <div className="font-bold text-[oklch(45%_0.02_80)]">Date:</div><div>{fax.dateLine}</div>
            <div className="font-bold text-[oklch(45%_0.02_80)]">Pages:</div><div>{fax.pages}</div>
            <div className="font-bold text-[oklch(45%_0.02_80)]">Re:</div><div>{fax.reLine}</div>
          </div>
          <div className="flex gap-[22px] mt-1 text-[13px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[13px] h-[13px] border-[1.6px] border-[oklch(40%_0.02_80)] rounded-[3px] inline-block" /> Urgent
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[13px] h-[13px] border-[1.6px] border-[oklch(40%_0.02_80)] rounded-[3px] inline-flex items-center justify-center text-[9px]">✓</span> Routine
            </span>
          </div>

          <hr className="border-t border-[var(--border)] my-[26px]" />

          <div className="text-[13px] text-[oklch(45%_0.02_80)] mb-3.5">{fax.letterDate}</div>
          <div className="text-[13px] mb-[18px] leading-relaxed">
            Sunrise Home Care<br />
            Attn: Intake Coordinator
          </div>
          <div className="font-bold text-[13.5px] mb-4">
            Re: Service Authorization Referral — In-Home Supportive Services (IHSS)
          </div>

          <p className="text-[13.5px] leading-relaxed mb-3.5">Dear Intake Coordinator,</p>
          <p className="text-[13.5px] leading-relaxed mb-3.5">
            Molina Healthcare has authorized In-Home Supportive Services for the member listed
            below. Please complete client intake and confirm caregiver assignment within five
            (5) business days of receipt of this referral.
          </p>

          <div className="font-display font-extrabold text-[13px] uppercase tracking-wide text-[oklch(38%_0.06_175)] bg-[var(--accent-soft)] inline-block px-3 py-1.5 rounded-md my-1.5">
            Member &amp; Authorization Details
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 bg-[oklch(97%_0.008_85)] border border-[var(--border)] rounded-[10px] px-[22px] py-[18px] mb-5">
            <DetailField label="Member Name" value={referral.clientName} />
            <DetailField label="Date of Birth" value={referral.dob} />
            <DetailField label="Medicaid ID" value={fax.medicaidId} />
            <DetailField label="Authorization #" value={referral.authNumber || '—'} />
            <DetailField label="Approved Service" value={referral.service} />
            <DetailField label="Authorized Hours" value={referral.authHours || '—'} />
            <DetailField label="Effective Dates" value={fax.effectiveDates} />
            <DetailField label="Reason for Referral" value={referral.diagnosis} />
          </div>

          <p className="text-[13.5px] leading-relaxed mb-3.5">
            Please complete and return the attached Client Intake Form and Caregiver Assignment
            Confirmation. For questions regarding this authorization, contact the care
            coordinator listed below.
          </p>

          <div className="text-[13.5px] leading-loose mt-7">
            Sincerely,<br />
            <strong>{fax.coordinatorName}</strong><br />
            Care Coordinator, Molina Healthcare<br />
            {fax.coordinatorPhone}
          </div>

          <div className="mt-11 pt-3.5 border-t border-[var(--border)] text-[10px] text-[oklch(58%_0.02_80)] leading-relaxed">
            This transmission contains confidential health information protected by federal and
            state law, including HIPAA. It is intended only for the addressee named above. If
            you have received this fax in error, please notify the sender immediately and
            destroy this document. Unauthorized review, use, disclosure, or distribution is
            prohibited.
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="text-[13.5px] font-semibold mt-0.5">{value}</div>
    </div>
  );
}
