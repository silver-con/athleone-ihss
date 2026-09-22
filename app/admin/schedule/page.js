import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregivers, getClients, getVisits, getOrganization, getAllServiceAuthorizations } from '@/lib/queries';
import { getComplianceProfile } from '@/lib/state-compliance';
import ScheduleClient from '@/components/admin/ScheduleClient';

export default async function SchedulePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const [caregivers, clients, allVisits, organization, serviceAuthorizations] = await Promise.all([
    getCaregivers(session.organizationId, session.locationId),
    getClients(session.organizationId, session.locationId),
    getVisits(session.organizationId, session.locationId),
    getOrganization(session.organizationId),
    getAllServiceAuthorizations(session.organizationId, session.locationId),
  ]);
  const reasonCodes = getComplianceProfile(organization?.state)?.reasonCodes || {};
  // This page is the current week's grid — backlog visits (`day: null`)
  // belong to the Compliance Center's maintenance queue instead.
  const visits = allVisits.filter((v) => v.day !== null);

  return (
    <ScheduleClient
      caregivers={caregivers}
      clients={clients}
      visits={visits}
      reasonCodes={reasonCodes}
      serviceAuthorizations={serviceAuthorizations}
    />
  );
}
