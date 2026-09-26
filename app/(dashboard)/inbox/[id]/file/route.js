// The original fax/document, for the review screen. Only for a signed-in
// user of the same agency (proxy.js checks the role; the query checks the
// agency). Never cached.
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getIncomingDocument } from '@/lib/queries';
import { getFile } from '@/lib/storage';

export async function GET(request, { params }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, 'shared.inbox.view')) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const doc = await getIncomingDocument(session.organizationId, id);
  if (!doc) return new Response('Not found', { status: 404 });
  let buffer;
  try {
    buffer = await getFile(doc.fileKey);
  } catch {
    return new Response('The file is missing from storage.', { status: 410 });
  }
  const download = new URL(request.url).searchParams.get('download') === '1';
  const name = (doc.fileName || `document-${doc.id}`).replace(/["\r\n]/g, '');
  return new Response(buffer, {
    headers: {
      'Content-Type': doc.mimeType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
