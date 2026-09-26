// POST a fax/document (multipart, field "file") into the inbox, then read
// it straight away. A route handler rather than a Server Action because
// files can be up to 20 MB (Server Actions are capped at 1 MB).
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { ingestDocument, processDocument } from '@/lib/intake';
import { logAuditEvent } from '@/lib/queries';

export async function POST(request) {
  const session = await getSession();
  if (!session || session.mustChangePassword || !hasPermission(session.role, 'shared.inbox.manage')) {
    return Response.json({ error: 'Not allowed.' }, { status: 403 });
  }
  // Same-origin only (the session cookie is SameSite=Lax, this is belt and braces).
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'Not allowed.' }, { status: 403 });

  let file;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return Response.json({ error: 'Send the file as form data.' }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a file.' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const r = await ingestDocument({
    organizationId: session.organizationId,
    buffer,
    fileName: file.name,
    source: 'upload',
    userId: session.userId,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  if (r.duplicateOf) return Response.json({ id: r.id, duplicate: true });
  await processDocument(session.organizationId, r.id);
  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'fax_uploaded',
    entityType: 'incoming_document',
    entityId: r.id,
    detail: file.name ? String(file.name).slice(0, 120) : null,
  });
  return Response.json({ id: r.id });
}
