import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import NewReferralForm from './NewReferralForm';

export default async function NewReferralPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return <NewReferralForm />;
}
