import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferral } from '@/lib/queries';
import { careNeedOptions } from '@/lib/data';
import IntakeForm from './IntakeForm';

export default async function IntakePage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  const referral = await getReferral(session.organizationId, id);

  if (!referral) {
    return (
      <div>
        <p className="text-[13.5px] text-[var(--muted)]">Referral not found.</p>
        <Link href="/referrals" className="text-[13px] font-bold font-display">‹ Back to Referrals</Link>
      </div>
    );
  }

  return <IntakeForm referral={referral} careNeedOptions={careNeedOptions} />;
}
