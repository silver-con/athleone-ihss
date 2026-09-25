import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import { verifyChallengeToken, CHALLENGE_COOKIE_NAME } from '@/lib/session';
import { getSignInChallenge } from '@/lib/queries';
import { emailConfig, smsConfig } from '@/lib/comms/config';
import VerifyCodeForm from './VerifyCodeForm';

export const metadata = { title: 'Enter your code — Hearth' };

// Second step of sign-in. Only reachable while holding a valid challenge
// cookie (set by loginAction after a correct password).
export default async function VerifyPage() {
  const token = (await cookies()).get(CHALLENGE_COOKIE_NAME)?.value;
  const challengeId = token ? await verifyChallengeToken(token) : null;
  const challenge = challengeId ? await getSignInChallenge(challengeId) : null;
  if (!challenge || challenge.consumedAt) redirect('/login');

  const live = challenge.channel === 'sms' ? smsConfig().live : emailConfig().live;
  const where = challenge.channel === 'sms' ? `a text to ${challenge.destination}` : `an email to ${challenge.destination}`;

  return (
    <AuthShell title="Check your phone or inbox" subtitle={`We sent a sign-in code in ${where}. It expires in 10 minutes.`}>
      {!live && (
        <p className="text-[12.5px] text-[oklch(42%_0.1_75)] bg-[oklch(95%_0.05_85)] border border-[oklch(86%_0.06_85)] rounded-xl px-3.5 py-2.5 mb-4">
          {challenge.channel === 'sms' ? 'Texting' : 'Email'} isn&rsquo;t connected on this server yet, so the code was
          written to the server log instead of being delivered.
        </p>
      )}
      <VerifyCodeForm />
    </AuthShell>
  );
}
