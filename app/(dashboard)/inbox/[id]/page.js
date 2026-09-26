import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getIncomingDocument, findIntakeDuplicates } from '@/lib/queries';
import ReviewForm from '@/components/intake/ReviewForm';
import RetryButton from '@/components/intake/RetryButton';
import RejectForm from '@/components/intake/RejectForm';

export const metadata = { title: 'Review fax — Athleone', referrer: 'no-referrer' };

// Side by side: the original fax on the left, what Athleone read on the right.
export default async function ReviewDocumentPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!hasPermission(session.role, 'shared.inbox.view')) redirect('/');
  const { id } = await params;
  const doc = await getIncomingDocument(session.organizationId, id);
  if (!doc) notFound();

  const approved = doc.status === 'approved';
  const fields = approved
    ? Object.fromEntries(Object.entries(doc.extraction?.approvedFields || {}).map(([k, v]) => [k, { value: v, source: 'reviewer' }]))
    : doc.extraction?.fields || {};
  const v = (k) => fields[k]?.value || '';
  const duplicates =
    doc.status === 'needs_review'
      ? await findIntakeDuplicates(session.organizationId, { medicaidId: v('medicaidId'), clientName: v('clientName'), dob: v('dob'), authNumber: v('authNumber') })
      : { clients: [], referrals: [] };
  const fileUrl = `/inbox/${doc.id}/file`;
  const isImage = doc.mimeType.startsWith('image/') && doc.mimeType !== 'image/tiff';

  return (
    <div className="max-w-[1400px]">
      <Link href="/inbox" className="inline-flex items-center gap-1.5 text-[13px] font-display font-bold text-[oklch(45%_0.02_80)] mb-3">
        ← Fax Inbox
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="font-display font-extrabold text-[22px] tracking-tight">{v('clientName') || doc.fileName || 'Incoming document'}</h1>
          <p className="text-[12.5px] text-[var(--muted)] mt-0.5">
            {doc.source === 'fax' ? `Fax${doc.sender ? ` from ${doc.sender}` : ''}` : doc.source === 'sample' ? 'Sample fax' : 'Uploaded'} ·{' '}
            {new Date(doc.receivedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}
            {doc.docType && doc.docType !== 'other' ? ` · looks like ${/^[aeiou]/i.test(doc.docType) ? 'an' : 'a'} ${doc.docType}` : ''}
            {doc.engine ? ` · read by ${doc.engine === 'google-docai' ? 'Google Document AI' : 'demo mode'}` : ''}
          </p>
        </div>
        <a href={`${fileUrl}?download=1`} className="text-[12.5px] font-display font-bold text-[var(--accent)]">
          Download original
        </a>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="bg-[oklch(93%_0.01_250)] border border-[var(--border)] rounded-2xl overflow-hidden lg:sticky lg:top-4">
          {doc.mimeType === 'application/pdf' ? (
            <iframe src={`${fileUrl}#view=FitH`} title="Original fax" className="w-full h-[78vh] bg-white" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt="Original fax" className="w-full" />
          ) : (
            <div className="p-8 text-center text-[13px] text-[var(--muted)]">
              TIFF faxes can&rsquo;t be shown in the browser. <a className="text-[var(--accent)] font-display font-bold" href={`${fileUrl}?download=1`}>Download it</a> to view.
            </div>
          )}
        </div>

        <div>
          {doc.status === 'failed' && (
            <div className="rounded-2xl border border-[oklch(85%_0.08_25)] bg-[var(--danger-soft)] px-4 py-3 mb-4">
              <div className="font-display font-extrabold text-[13.5px] text-[var(--danger)]">Athleone couldn&rsquo;t read this document</div>
              <p className="text-[12.5px] mt-1">{doc.error}</p>
              <div className="flex flex-wrap gap-2 mt-3 items-center">
                <RetryButton documentId={doc.id} />
                <Link href="/referrals/new" className="text-[12.5px] font-display font-bold text-[var(--accent)]">
                  Enter the referral by hand
                </Link>
              </div>
              <RejectForm documentId={doc.id} />
            </div>
          )}
          {(doc.status === 'received' || doc.status === 'processing') && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 mb-4 text-[12.5px]">
              {doc.stuck
                ? 'Reading this document was interrupted. Read it again, or reject it.'
                : 'Still reading this document — refresh in a moment.'}{' '}
              {(doc.status === 'received' || doc.stuck) && <RetryButton documentId={doc.id} />}
              {doc.stuck && <RejectForm documentId={doc.id} />}
            </div>
          )}
          {approved && (
            <div className="rounded-2xl border border-[oklch(85%_0.06_150)] bg-[var(--success-soft)] px-4 py-3 mb-4 text-[12.5px]">
              Approved by {doc.reviewedByName || 'staff'} on {new Date(doc.reviewedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}.{' '}
              {doc.referralId && (
                <Link href={`/referrals/${doc.referralId}`} className="font-display font-bold text-[var(--accent)]">
                  Open the referral →
                </Link>
              )}
            </div>
          )}
          {doc.status === 'rejected' && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 mb-4 text-[12.5px]">
              Rejected by {doc.reviewedByName || 'staff'}: {doc.rejectReason}
            </div>
          )}

          {(doc.status === 'needs_review' || approved) && (
            <ReviewForm documentId={doc.id} initialFields={fields} duplicates={duplicates} readOnly={approved} />
          )}

          {doc.rawText && (
            <details className="mt-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
              <summary className="cursor-pointer font-display font-bold text-[12.5px]">Text read from the document</summary>
              <pre className="mt-3 text-[11.5px] whitespace-pre-wrap font-mono text-[oklch(35%_0.02_80)] max-h-[360px] overflow-y-auto">{doc.rawText.replace(/\f/g, '\n\n— next page —\n\n')}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
