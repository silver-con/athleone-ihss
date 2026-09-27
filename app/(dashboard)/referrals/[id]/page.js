import Link from 'next/link';
import { openMissingIds } from '@/lib/docai/id-checks';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferral } from '@/lib/queries';
import { statusInfo } from '@/lib/styles';

export default async function ReferralDetailPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  const referral = await getReferral(session.organizationId, id);

  if (!referral) {
    return (
      <div>
        <p className="text-[13.5px] text-[var(--muted)]">Referral not found.</p>
        <Link href="/referrals" className="text-[13px] font-bold font-display">
          ‹ Back to Referrals
        </Link>
      </div>
    );
  }

  const status = statusInfo(referral.status);

  return (
    <div>
      <Link
        href="/referrals"
        className="inline-flex items-center gap-1.5 text-[13px] font-display font-bold text-[oklch(45%_0.02_80)] mb-4"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Referrals
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-extrabold text-[22px]">{referral.clientName}</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">
            Referral from {referral.payer} · Received {referral.receivedDate}
          </p>
        </div>
        <span className="flex flex-col items-end gap-1.5">
          <span className={'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap ' + status.className}>
            {status.label}
          </span>
          {!referral.authNumber && (
            <span className="text-[11px] font-display font-bold px-2.5 py-1 rounded-full whitespace-nowrap bg-[oklch(95%_0.05_85)] text-[oklch(42%_0.1_75)]">Awaiting authorization</span>
          )}
        </span>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <dl className="grid grid-cols-[130px_1fr] gap-y-2.5 text-[13px]">
          <dt className="font-bold text-[var(--muted)]">Date of Birth</dt>
          <dd>{referral.dob}</dd>
          <dt className="font-bold text-[var(--muted)]">Service</dt>
          <dd>{referral.service}</dd>
          <dt className="font-bold text-[var(--muted)]">Authorization #</dt>
          <dd>{referral.authNumber || '—'}</dd>
          <dt className="font-bold text-[var(--muted)]">Authorized Hours</dt>
          <dd>{referral.authHours || '—'}</dd>
          {referral.fax?.planMemberId && (
            <>
              <dt className="font-bold text-[var(--muted)]">Plan member ID</dt>
              <dd>{referral.fax.planMemberId}</dd>
            </>
          )}
          <dt className="font-bold text-[var(--muted)]">Reason</dt>
          <dd>{referral.diagnosis}</dd>
        </dl>

        {Array.isArray(referral.fax?.idAcknowledgments) && referral.fax.idAcknowledgments.length > 0 && (
          <div className="mt-5 pt-5 border-t border-[var(--border)] text-[12.5px]">
            <div className="font-display font-bold mb-1.5">
              IDs acknowledged at approval{openMissingIds(referral).length > 0 ? ` — ${openMissingIds(referral).length} still missing` : ''}
            </div>
            <ul className="space-y-1">
              {referral.fax.idAcknowledgments.map((r) => (
                <li key={r.field}>
                  <strong>{r.label}</strong> — {r.state === 'missing' ? 'missing' : 'checked'}: {r.reasonLabel || r.reason}
                  {r.note ? ` (${r.note})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(referral.fax?.serviceLines) && referral.fax.serviceLines.length > 1 && (
          <div className="mt-5 pt-5 border-t border-[var(--border)] text-[12.5px]">
            <div className="font-display font-bold mb-1.5">Service lines on the fax</div>
            <ul className="space-y-1">
              {referral.fax.serviceLines.map((l, i) => (
                <li key={i}>
                  {i === (referral.fax.primaryLine || 0) ? <strong>Primary: </strong> : null}
                  {[[l.serviceCode, l.modifier].filter(Boolean).join(' '), l.serviceType, l.authStart && l.authEnd ? `${l.authStart} – ${l.authEnd}` : null, l.lineStatus].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {referral.fax ? (
          <div className="mt-5 pt-5 border-t border-[var(--border)]">
            <Link
              href={referral.fax.documentId ? `/inbox/${referral.fax.documentId}` : `/fax/${referral.id}`}
              className="inline-flex items-center gap-2 border border-[oklch(80%_0.02_85)] rounded-[9px] px-4 py-2.5 font-display font-bold text-[13px] text-[oklch(30%_0.02_80)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
              </svg>
              View original referral fax
            </Link>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-[var(--border)] text-[13px] text-[var(--muted)]">
            No fax document on file for this referral.
          </div>
        )}
      </div>

      {referral.status !== 'completed' && (
        <Link
          href={`/referrals/${referral.id}/intake`}
          className="inline-block mt-6 bg-[var(--accent-strong)] text-white rounded-[10px] px-5 py-3 font-display font-bold text-[13.5px]"
        >
          Start Intake
        </Link>
      )}
    </div>
  );
}
