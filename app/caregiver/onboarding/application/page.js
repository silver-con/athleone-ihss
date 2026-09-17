import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregiver, getApplication } from '@/lib/queries';
import ApplicationForm from './ApplicationForm';

export default async function CaregiverApplicationPage() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const [me, existing] = await Promise.all([
    getCaregiver(session.organizationId, session.caregiverId),
    getApplication(session.organizationId, session.caregiverId),
  ]);

  return (
    <div>
      <Link
        href="/caregiver/onboarding"
        className="flex items-center gap-1.5 text-[12px] font-display font-bold text-[var(--muted)] mb-3"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </Link>

      <h2 className="font-display font-extrabold text-[19px]">Employment application</h2>
      <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-4">
        {existing
          ? 'You already submitted this. Submitting again replaces your previous answers.'
          : 'Personal Assistance Services. Takes about ten minutes.'}
      </p>

      <ApplicationForm defaults={{ name: me?.name, phone: me?.phone, email: me?.email }} />
    </div>
  );
}
