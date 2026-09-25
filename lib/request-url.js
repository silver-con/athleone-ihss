// The public base address for links Hearth puts in emails and texts.
//
// APP_BASE_URL wins. Without it, the address is taken from the request —
// fine on a laptop, but in production that would let anyone who can send a
// request with a forged Host header get a password-reset email whose link
// points at THEIR site (a classic reset-poisoning attack). So in production
// with no APP_BASE_URL this returns null and callers must not send links.
import { headers } from 'next/headers';
import { appBaseUrl } from '@/lib/comms/config';

export async function trustedBaseUrl() {
  const configured = appBaseUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return null;
  const h = await headers();
  const host = h.get('host');
  if (!host) return null;
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
