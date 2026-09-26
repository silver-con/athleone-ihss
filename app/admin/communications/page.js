import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOrganization, getNotifications, getNotificationCounts } from '@/lib/queries';
import { commsStatus } from '@/lib/comms/config';
import StatTile from '@/components/StatTile';
import ProviderStatusCard from '@/components/comms/ProviderStatusCard';
import OutboxTable from '@/components/comms/OutboxTable';
import CommsSettingsForm from '@/components/admin/CommsSettingsForm';
import CommsTestForms from '@/components/admin/CommsTestForms';

// Email & text messaging for this agency: whether the platform's providers
// are connected, this agency's notification settings, a test send, and the
// outbox (everything sent — or, before a provider is connected, everything
// that WOULD have been sent). ADMIN only (lib/permissions.js).
export default async function CommunicationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [organization, rows, counts] = await Promise.all([
    getOrganization(session.organizationId),
    getNotifications(session.organizationId, { limit: 100 }),
    getNotificationCounts(session.organizationId, 30),
  ]);
  const status = commsStatus();
  const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);
  const failed = (counts.email.failed || 0) + (counts.sms.failed || 0) + (counts.sms.undelivered || 0);

  return (
    <div className="max-w-[1000px]">
      <h1 className="font-display font-extrabold text-[24px]">Communications</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 mb-6 max-w-[720px]">
        Email and text messages Athleone sends for {organization?.name || 'your agency'}: password resets, sign-in codes,
        new-account welcomes, and message notifications between the office and caregivers.
      </p>

      <div className="flex flex-wrap gap-3">
        <ProviderStatusCard kind="email" status={status.email} />
        <ProviderStatusCard kind="sms" status={status.sms} />
      </div>

      {!status.appBaseUrl && (
        <p className="text-[12.5px] text-[oklch(45%_0.1_75)] mt-3">
          <strong>APP_BASE_URL</strong> isn&rsquo;t set, so links in emails point at whatever address the request came
          from. Set it to your public address (for example https://app.youragency.com) in production.
        </p>
      )}

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={total(counts.email)} label="Emails, last 30 days" />
        <StatTile num={total(counts.sms)} label="Texts, last 30 days" />
        <StatTile num={failed} label="Failed / undelivered" accent={failed ? 'oklch(52% 0.16 25)' : undefined} />
      </div>

      <div className="grid gap-4 mt-6 md:grid-cols-2">
        <CommsSettingsForm notifyEmail={organization?.notifyEmail} caregiverNotifyChannel={organization?.caregiverNotifyChannel || 'sms'} />
        <CommsTestForms defaultEmail={session.email} />
      </div>

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="font-display font-extrabold text-[15px]">Outbox</div>
        <p className="text-[12.5px] text-[var(--muted)] mt-1 mb-3">The latest 100 messages, newest first.</p>
        <OutboxTable rows={rows} />
      </section>
    </div>
  );
}
