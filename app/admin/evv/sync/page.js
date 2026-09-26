import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getEvvCredentials, getSyncLog, getVisits } from '@/lib/queries';
import StatTile from '@/components/StatTile';
import EvvCredentialsForm from '@/components/admin/EvvCredentialsForm';
import { EvvSyncButtons, RetryButton } from '@/components/admin/EvvSyncControls';

const STATUS_STYLE = {
  pending: { label: 'Queued', className: 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]' },
  sent: { label: 'Awaiting state', className: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]' },
  acknowledged: { label: 'Confirmed by state', className: 'bg-[var(--success-soft)] text-[var(--success)]' },
  failed: { label: 'Failed', className: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]' },
};

const ENV_LABEL = { sandbox: 'Sandbox / Implementation', production: 'Production' };

export default async function EvvSyncPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [credentials, log, visits] = await Promise.all([
    getEvvCredentials(session.organizationId),
    getSyncLog(session.organizationId, 100, session.locationId),
    getVisits(session.organizationId, session.locationId),
  ]);

  const count = (s) => log.filter((r) => r.status === s).length;

  // The number that actually matters for an EVV usage score: completed
  // visits sitting in Hearth that the state has not confirmed.
  const completedVisits = visits.filter((v) => v.status === 'completed');
  const confirmedVisitIds = new Set(
    log.filter((r) => r.status === 'acknowledged').map((r) => r.visitId)
  );
  const unconfirmed = completedVisits.filter((v) => !confirmedVisitIds.has(v.id)).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">EVV Transmission</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">
            What Athleone has sent to the state EVV aggregator, and what the state has actually confirmed.
            A visit recorded here is not compliant until it&rsquo;s confirmed there.
          </p>
        </div>
        <Link
          href="/admin/evv"
          className="text-[12.5px] font-display font-bold text-[var(--accent)] whitespace-nowrap shrink-0"
        >
          ← EVV exceptions
        </Link>
      </div>

      {!credentials && (
        <div className="bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-4 mt-6">
          <div className="font-display font-extrabold text-[13.5px] text-[oklch(42%_0.1_75)]">
            Not connected to the state aggregator
          </div>
          <p className="text-[12.5px] text-[oklch(42%_0.1_75)] mt-1">
            Visits are being recorded in Athleone and queued, but nothing is being transmitted. Until this
            connection is live and certified, the agency is not meeting its Texas EVV obligation.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={count('pending')} label="Queued to send" />
        <StatTile num={count('sent')} label="Awaiting the state" />
        <StatTile num={count('acknowledged')} label="Confirmed by state" />
        <StatTile
          num={count('failed')}
          label="Failed"
          accent={count('failed') > 0 ? 'var(--danger)' : undefined}
        />
        <StatTile
          num={unconfirmed}
          label="Completed visits not yet confirmed"
          accent={unconfirmed > 0 ? 'oklch(58% 0.13 55)' : undefined}
        />
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="font-display font-extrabold text-[14.5px]">Connection</div>
            {credentials ? (
              <p className="text-[12.5px] text-[var(--muted)] mt-1">
                {ENV_LABEL[credentials.environment]} · status{' '}
                <strong className="text-[oklch(30%_0.02_80)]">{credentials.status}</strong>
                {credentials.lastSuccessAt
                  ? ` · last successful contact ${new Date(credentials.lastSuccessAt).toLocaleString('en-US')}`
                  : ' · no successful contact yet'}
              </p>
            ) : (
              <p className="text-[12.5px] text-[var(--muted)] mt-1">No credentials saved.</p>
            )}
          </div>
          <EvvSyncButtons configured={Boolean(credentials)} />
        </div>
      </div>

      {/* Only the fields the form shows — the encrypted client id/secret
          never go to the browser, even encrypted. */}
      <EvvCredentialsForm
        credentials={
          credentials && {
            apiBaseUrl: credentials.apiBaseUrl,
            apiVersion: credentials.apiVersion,
            environment: credentials.environment,
            officeIdentifier: credentials.officeIdentifier,
            officeQualifier: credentials.officeQualifier,
            payerId: credentials.payerId,
            providerTaxId: credentials.providerTaxId,
            scope: credentials.scope,
          }
        }
      />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-4">
        <div className="grid grid-cols-[1.2fr_1.1fr_0.9fr_1fr_1.3fr_1.6fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>Client</div>
          <div>Caregiver</div>
          <div>Service date</div>
          <div>Operation</div>
          <div>Status</div>
          <div>Detail</div>
        </div>

        {log.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            Nothing queued yet. A visit joins this list when a caregiver clocks out, or when an
            exception is resolved.
          </div>
        )}

        {log.map((row) => {
          const style = STATUS_STYLE[row.status] || STATUS_STYLE.pending;
          return (
            <div
              key={row.id}
              className="grid grid-cols-[1.2fr_1.1fr_0.9fr_1fr_1.3fr_1.6fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
            >
              <div className="font-display font-bold text-[13.5px]">{row.clientName || '—'}</div>
              <div>{row.caregiverName || '—'}</div>
              <div>{row.serviceDate || '—'}</div>
              <div className="text-[12px] text-[var(--muted)]">
                {row.operation.replace('visit_', '')}
                {row.attempts > 1 ? ` · ${row.attempts} attempts` : ''}
              </div>
              <div>
                <span
                  className={
                    'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ' +
                    style.className
                  }
                >
                  {style.label}
                </span>
              </div>
              <div className="text-[12px] text-[var(--muted)] min-w-0">
                {row.status === 'failed' ? (
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--danger)] min-w-0 break-words">{row.lastError}</span>
                    <RetryButton rowId={row.id} />
                  </div>
                ) : row.evvmsId ? (
                  <span title="The aggregator's own identifier for this visit">{row.evvmsId}</span>
                ) : row.transactionId ? (
                  <span>txn {row.transactionId}</span>
                ) : (
                  '—'
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
