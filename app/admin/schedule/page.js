import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregivers, getClients, getVisits } from '@/lib/queries';
import ScheduleClient from '@/components/admin/ScheduleClient';

export default async function SchedulePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [caregivers, clients, allVisits] = await Promise.all([
    getCaregivers(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getVisits(session.organizationId, session.locationId),
  ]);
  // This page is the current week's grid — backlog visits (`day: null`)
  // belong to the Compliance Center's maintenance queue instead.
  const visits = allVisits.filter((v) => v.day !== null);

  return <ScheduleClient caregivers={caregivers} clients={clients} visits={visits} />;
}
