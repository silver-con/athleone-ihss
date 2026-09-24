import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getCaregivers, getClients, getVisits, getOrganization, getAllServiceAuthorizations } from '@/lib/queries';
import { getComplianceProfile } from '@/lib/state-compliance';
import ScheduleClient from '@/components/admin/ScheduleClient';
import { resolveWeekStart, getWeek, isInWeek, todayIso } from '@/lib/calendar';

export default async function SchedulePage({ searchParams }) {
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
  // One real calendar week (?week=, default this week — 2026-09-24; this
  // used to be the fixed demo week of Sep 14–20).
  const weekStart = resolveWeekStart((await searchParams)?.week);
  const week = getWeek(weekStart);
  const visits = allVisits.filter((v) => isInWeek(v.serviceDate, weekStart));

  return (
    <ScheduleClient
      caregivers={caregivers}
      clients={clients}
      visits={visits}
      week={week}
      weekStart={weekStart}
      today={todayIso()}
      reasonCodes={reasonCodes}
      serviceAuthorizations={serviceAuthorizations}
    />
  );
}
