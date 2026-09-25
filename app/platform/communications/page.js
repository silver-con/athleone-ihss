import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getPlatformNotificationSummary } from '@/lib/queries';
import { commsStatus } from '@/lib/comms/config';
import ProviderStatusCard from '@/components/comms/ProviderStatusCard';
import PlatformCommsTestForm from '@/components/platform/PlatformCommsTestForm';

// Hearth staff view of the platform-wide email/SMS providers. Shows counts
// per agency only — never recipients or message content, which belong to
// each agency (platform admins don't see tenant data, architecture spec §3).
export default async function PlatformCommunicationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const status = commsStatus();
  const summary = await getPlatformNotificationSummary(30);

  const byOrg = new Map();
  for (const r of summary) {
    const key = r.organizationId || 'platform';
    if (!byOrg.has(key)) byOrg.set(key, { name: r.organizationName || 'Hearth platform (no agency)', email: 0, sms: 0, failed: 0 });
    const o = byOrg.get(key);
    o[r.channel] += r.count;
    if (['failed', 'undelivered'].includes(r.status)) o.failed += r.count;
  }

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">Email &amp; SMS</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 mb-6 max-w-[720px]">
        One set of provider accounts serves every agency. Keys live in the server environment, never in the database.
      </p>
      <div className="flex flex-wrap gap-3">
        <ProviderStatusCard kind="email" status={status.email} />
        <ProviderStatusCard kind="sms" status={status.sms} />
      </div>
      <div className="mt-4 text-[12.5px] text-[var(--muted)]">
        APP_BASE_URL: <span className="font-mono">{status.appBaseUrl || 'not set'}</span> · Message text in notices:{' '}
        <strong>{status.includeMessageText ? 'included (NOTIFY_INCLUDE_MESSAGE_TEXT=true)' : 'off (default)'}</strong>
      </div>
      <div className="mt-6">
        <PlatformCommsTestForm defaultEmail={session.email} />
      </div>
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="font-display font-extrabold text-[15px] mb-3">Last 30 days by agency</div>
        {byOrg.size === 0 ? (
          <p className="text-[12.5px] text-[var(--muted)]">Nothing sent yet.</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)] font-display">
                <th className="py-2">Agency</th>
                <th className="py-2">Emails</th>
                <th className="py-2">Texts</th>
                <th className="py-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {[...byOrg.values()].map((o) => (
                <tr key={o.name} className="border-t border-[var(--border)]">
                  <td className="py-2 font-display font-bold">{o.name}</td>
                  <td className="py-2">{o.email}</td>
                  <td className="py-2">{o.sms}</td>
                  <td className="py-2" style={o.failed ? { color: 'var(--danger)' } : undefined}>{o.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
