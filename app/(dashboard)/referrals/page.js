import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferrals } from '@/lib/queries';
import { payerClass, statusInfo } from '@/lib/styles';
import Toast from '@/components/Toast';

export default async function ReferralsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const referrals = await getReferrals(session.organizationId);

  const newCount = referrals.filter((r) => r.status === 'new').length;
  const inProgressCount = referrals.filter((r) => r.status === 'in-progress').length;
  const completedCount = referrals.filter((r) => r.status === 'completed').length;

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px] tracking-tight">Referrals</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Incoming client referrals from health plans and hospitals
      </p>

      <div className="flex gap-3 mt-6">
        <StatChip num={newCount} label="New" />
        <StatChip num={inProgressCount} label="In progress" />
        <StatChip num={completedCount} label="Completed this week" />
      </div>

      <Suspense fallback={null}>
        <Toast />
      </Suspense>

      <div className="flex flex-col gap-2.5 mt-6">
        {referrals.map((r) => {
          const status = statusInfo(r.status);
          return (
            <div
              key={r.id}
              className="flex items-center gap-[18px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4"
            >
              <span className={'text-[10.5px] font-display font-bold px-2.5 py-1 rounded-md whitespace-nowrap ' + payerClass(r.payer)}>
                {r.payer}
              </span>

              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[14.5px]">{r.clientName}</div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">DOB {r.dob}</div>
              </div>

              <div className="text-[12.5px] text-[oklch(45%_0.02_80)] w-[170px] leading-snug">
                {r.service}<br />{r.authHours}
              </div>

              <div className="text-[12.5px] text-[oklch(45%_0.02_80)] w-[110px] leading-snug">
                Received<br />{r.receivedDate}
              </div>

              <span className={'text-[11px] font-display font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap ' + status.className}>
                {status.label}
              </span>

              <Link
                href={`/referrals/${r.id}`}
                className="border border-[oklch(80%_0.02_85)] bg-[var(--surface)] rounded-[9px] px-3.5 py-2 font-display font-bold text-[12.5px] text-[oklch(30%_0.02_80)] whitespace-nowrap"
              >
                View
              </Link>

              {r.status !== 'completed' ? (
                <Link
                  href={`/referrals/${r.id}/intake`}
                  className="bg-[var(--accent-strong)] text-white rounded-[9px] px-3.5 py-2 font-display font-bold text-[12.5px] whitespace-nowrap"
                >
                  Start Intake
                </Link>
              ) : (
                <span className="text-[12px] font-display font-bold text-[var(--success)] whitespace-nowrap px-1">
                  Completed ✓
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatChip({ num, label }) {
  return (
    <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-[18px] py-3.5">
      <div className="font-display font-extrabold text-[22px]">{num}</div>
      <div className="text-[12px] text-[var(--muted)] mt-0.5">{label}</div>
    </div>
  );
}
