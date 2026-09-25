'use server';

// "Forgot password?" — public Server Actions (no session: the person can't
// sign in, that's the point). All the rules are in lib/sign-in.js.
import { redirect } from 'next/navigation';
import { requestPasswordReset, completePasswordReset, RESET_REQUESTED_MESSAGE } from '@/lib/sign-in';
import { trustedBaseUrl } from '@/lib/request-url';

export async function requestPasswordResetAction(prevState, formData) {
  const email = String(formData.get('email') || '').trim();
  if (!email) return { error: 'Enter the email you sign in with.' };
  const baseUrl = await trustedBaseUrl();
  if (!baseUrl) {
    // Production with no APP_BASE_URL: refuse to build a link from the
    // request's Host header (see lib/request-url.js). Same answer to the
    // person, so this doesn't reveal anything about the account.
    console.error('[password-reset] APP_BASE_URL is not set; reset email not sent. Set APP_BASE_URL to the public https address.');
    return { done: true, message: RESET_REQUESTED_MESSAGE };
  }
  const r = await requestPasswordReset(email, { baseUrl });
  return { done: true, message: r.message };
}

export async function resetPasswordAction(prevState, formData) {
  const token = String(formData.get('token') || '');
  const r = await completePasswordReset(token, String(formData.get('newPassword') || ''), String(formData.get('confirmPassword') || ''));
  if (!r.ok) return { error: r.error };
  redirect('/login?reset=1');
}
