import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOrganization } from '@/lib/queries';
import { getComplianceProfile } from '@/lib/state-compliance';
import EvvSettingsForm from '@/components/admin/EvvSettingsForm';

// Agency settings — the per-agency "configurator" (see the project doc
// vesta-evv-feature-reference.md). ADMIN only. More settings join this
// page over time instead of being hardcoded.
export default async function AdminSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const organization = await getOrganization(session.organizationId);
  const profile = getComplianceProfile(organization?.state);

  return (
    <div className="max-w-[820px]">
      <h1 className="font-display font-extrabold text-[24px]">Settings</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 mb-6">
        How Hearth applies EVV rules for {organization?.name || 'your agency'}. Every change is recorded in the audit log.
      </p>
      <EvvSettingsForm
        organization={{
          flexibleHoursEnabled: Boolean(organization?.flexibleHoursEnabled),
          flexibleHoursGraceMinutes: organization?.flexibleHoursGraceMinutes ?? 20,
          visitMaintenanceWindowDays: organization?.visitMaintenanceWindowDays ?? null,
          homeRadiusFeet: organization?.homeRadiusFeet ?? 250,
        }}
        stateDays={profile?.visitMaintenanceWindowDays ?? null}
        stateName={profile?.stateName || organization?.state || 'Your state'}
      />
    </div>
  );
}
