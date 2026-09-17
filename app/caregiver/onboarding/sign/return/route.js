// DocuSign's embedded-signing returnUrl. This is a Route Handler, not a
// Server Action, because DocuSign redirects the caregiver's browser here
// with a plain GET and query params (?event=..&envelopeId=..) — there's no
// form submission to hang a Server Action off of.
//
// The event query param is DocuSign's own signal, but it only tells us the
// caregiver's browser got redirected — not that DocuSign actually recorded
// the envelope as completed. We re-check the envelope's real status via
// the API before marking anything signed, rather than trusting the
// redirect alone.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import * as db from '@/lib/queries';
import { getEnvelope } from '@/lib/docusign';

export async function GET(request) {
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  const session = await getSession();

  if (!session?.caregiverId) {
    return NextResponse.redirect(`${base}/login`);
  }

  const envelopeId = url.searchParams.get('envelopeId');
  const event = url.searchParams.get('event');

  if (envelopeId && event === 'signing_complete') {
    try {
      const credentials = await db.getDocusignCredentials(session.organizationId);
      if (credentials) {
        const { status } = await getEnvelope(credentials, envelopeId);
        if (status === 'completed') {
          await db.markPacketSigned(session.organizationId, session.caregiverId, envelopeId);
        }
      }
    } catch {
      // Leave the documents in 'sent' state — the office can see that on
      // the caregiver's HR record and re-check or re-send; don't block the
      // caregiver's own redirect back to their checklist over this.
    }
  }

  return NextResponse.redirect(`${base}/caregiver/onboarding`);
}
