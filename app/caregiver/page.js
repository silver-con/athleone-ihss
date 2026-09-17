import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregiver } from '@/lib/queries';

// A caregiver who hasn't finished onboarding lands on the checklist rather
// than a schedule she can't work yet. Once she's active, the app opens on
// her schedule as before.
export default async function CaregiverHome() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const me = await getCaregiver(session.organizationId, session.caregiverId);
  if (me && ['applicant', 'onboarding'].includes(me.status)) {
    redirect('/caregiver/onboarding');
  }
  redirect('/caregiver/schedule');
}
