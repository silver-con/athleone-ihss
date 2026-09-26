import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getIncomingDocuments, getOrganizationFaxSettings } from '@/lib/queries';
import { hasPermission } from '@/lib/permissions';
import { docaiStatus } from '@/lib/docai';
import { SAMPLE_FAXES, sampleFaxesEnabled } from '@/lib/docai/samples';
import { appBaseUrl } from '@/lib/comms/config';
import { FIELDS } from '@/lib/docai/fields';
import UploadDropzone from '@/components/intake/UploadDropzone';
import SampleFaxButtons from '@/components/intake/SampleFaxButtons';
import FaxSettingsPanel from '@/components/intake/FaxSettingsPanel';

export const metadata = { title: 'Fax Inbox — Athleone' };

const STATUS = {
  received: ['Received', 'oklch(40% 0.08 250)', 'oklch(95% 0.03 250)'],
  processing: ['Reading…', 'oklch(40% 0.08 250)', 'oklch(95% 0.03 250)'],
  needs_review: ['Needs review', 'oklch(42% 0.1 75)', 'oklch(95% 0.05 85)'],
  failed: ['Couldn’t read', 'oklch(45% 0.16 25)', 'oklch(95% 0.04 25)'],
  approved: ['Approved', 'oklch(38% 0.1 150)', 'oklch(94% 0.05 150)'],
  rejected: ['Rejected', 'oklch(45% 0.02 80)', 'oklch(95% 0.005 85)'],
};

const TABS = [
  ['open', 'To review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];

function when(d) {
  return new Date(d).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default async function InboxPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!hasPermission(session.role, 'shared.inbox.view')) redirect('/');
  const canManage = hasPermission(session.role, 'shared.inbox.manage');
  const params = await searchParams;
  const tab = TABS.some(([k]) => k === params?.tab) ? params.tab : 'open';
  const all = await getIncomingDocuments(session.organizationId);
  const open = all.filter((d) => ['received', 'processing', 'needs_review', 'failed'].includes(d.status));
  const rows = tab === 'open' ? open : tab === 'all' ? all : all.filter((d) => d.status === tab);
  const engine = docaiStatus();
  const isAdmin = hasPermission(session.role, 'admin.fax.manage');
  const fax = isAdmin ? await getOrganizationFaxSettings(session.organizationId) : null;
  const base = appBaseUrl();

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px] tracking-tight">Fax Inbox</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[680px]">
            Incoming referral and authorization faxes. Athleone reads each one and fills in the referral; you check it
            against the fax and approve. Nothing becomes a referral until someone approves it.
          </p>
        </div>
        <Link href="/referrals/new" className="text-[12.5px] font-display font-bold text-[var(--accent)] whitespace-nowrap mt-1">
          Enter by hand instead
        </Link>
      </div>

      <div
        className={
          'mt-5 rounded-2xl px-4 py-3 text-[12.5px] border ' +
          (engine.live ? 'bg-[var(--success-soft)] border-[oklch(85%_0.06_150)]' : 'bg-[oklch(95%_0.05_85)] border-[oklch(86%_0.06_85)]')
        }
      >
        <strong className="font-display">Reading engine:</strong> {engine.label}
        {engine.provider === 'demo' && ` — it can read typed PDFs${sampleFaxesEnabled() ? ' such as the samples below' : ''}, but not scanned faxes. Connect Google Document AI to read real faxes (docs/FAX-INTAKE.md).`}
        {engine.provider === 'google' && !engine.live && ` — missing ${engine.missing.join(', ')}.`}
      </div>

      <div className="grid md:grid-cols-[1fr_auto] gap-3 mt-4 items-start">
        {canManage && <UploadDropzone engineLabel={engine.provider === 'google' ? 'Google Document AI' : 'demo mode (typed PDFs only)'} />}
      </div>
      {canManage && sampleFaxesEnabled() && (
        <div className="mt-3">
          <SampleFaxButtons samples={SAMPLE_FAXES} />
        </div>
      )}

      <div className="flex gap-1 mt-6 border-b border-[var(--border)]">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={k === 'open' ? '/inbox' : `/inbox?tab=${k}`}
            className={
              'px-3.5 py-2 text-[12.5px] font-display font-bold border-b-2 -mb-px ' +
              (tab === k ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]')
            }
          >
            {label}
            {k === 'open' && open.length > 0 && <span className="ml-1.5 text-[11px]">({open.length})</span>}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 mt-4">
        {rows.length === 0 && (
          <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-2xl px-5 py-8 text-center text-[13px] text-[var(--muted)]">
            {tab === 'open' ? 'Nothing waiting. New faxes appear here as they arrive.' : 'Nothing here yet.'}
          </div>
        )}
        {rows.map((d) => {
          const [label, fg, bg] = STATUS[d.status] || [d.status, 'inherit', 'transparent'];
          const f = d.extraction?.approvedFields
            ? Object.fromEntries(Object.entries(d.extraction.approvedFields).map(([k, v]) => [k, { value: v }]))
            : d.extraction?.fields || {};
          const found = FIELDS.filter((x) => f[x.key]?.value).length;
          return (
            <Link
              key={d.id}
              href={`/inbox/${d.id}`}
              className="flex items-center gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-3.5 hover:border-[var(--accent)]"
            >
              <span className="text-[11px] font-display font-bold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ color: fg, background: bg }}>
                {label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[14px] truncate">
                  {f.clientName?.value || d.fileName || 'Untitled document'}
                  {f.payer?.value && <span className="font-normal text-[var(--muted)]"> · {f.payer.value}</span>}
                </div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5 truncate">
                  {d.source === 'fax' ? `Fax${d.sender ? ` from ${d.sender}` : ''}` : d.source === 'sample' ? 'Sample fax' : 'Uploaded'}
                  {d.docType && d.docType !== 'other' ? ` · ${d.docType}` : ''}
                  {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : ''}
                  {d.status === 'needs_review' ? ` · ${found} of ${FIELDS.length} fields found` : ''}
                  {d.status === 'failed' && d.error ? ` · ${d.error}` : ''}
                  {d.reviewedByName ? ` · ${d.status} by ${d.reviewedByName}` : ''}
                </div>
              </div>
              <span className="text-[12px] text-[var(--muted)] whitespace-nowrap">{when(d.receivedAt)}</span>
            </Link>
          );
        })}
      </div>

      {isAdmin && (
        <div className="mt-8">
          <FaxSettingsPanel
            webhookBase={base ? `${base}/api/webhooks/fax?org=${encodeURIComponent(session.organizationId)}` : null}
            faxNumber={fax?.faxNumber}
            webhookConfigured={Boolean(fax?.webhookConfigured)}
          />
        </div>
      )}
    </div>
  );
}
