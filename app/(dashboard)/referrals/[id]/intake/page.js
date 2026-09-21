import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getReferral, getLocations } from '@/lib/queries';
import { careNeedOptions } from '@/lib/data';
import IntakeForm from './IntakeForm';

export default async function IntakePage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  const [referral, locations] = await Promise.all([
    getReferral(session.organizationId, id),
    getLocations(session.organizationId, { activeOnly: true }),
  ]);
  // A location admin's intake always lands in their own location — the
  // action pins it regardless, so the form should only offer that one.
  const intakeLocations = session.locationId
    ? locations.filter((l) => l.id === session.locationId)
    : locations;

  if (!referral) {
    return (
      <div>
        <p className="text-[13.5px] text-[var(--muted)]">Referral not found.</p>
        <Link href="/referrals" className="text-[13px] font-bold font-display">‹ Back to Referrals</Link>
      </div>
    );
  }

  return <IntakeForm referral={referral} careNeedOptions={careNeedOptions} locations={intakeLocations} />;
}
