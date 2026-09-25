import Link from 'next/link';
import AuthShell, { ErrorBox } from '@/components/auth/AuthShell';
import { isResetTokenUsable } from '@/lib/sign-in';
import { PASSWORD_MIN_LENGTH } from '@/lib/passwords';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata = { title: 'Choose a new password — Hearth', referrer: 'no-referrer' };

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.token === 'string' ? params.token : '';
  const usable = await isResetTokenUsable(token);

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={usable ? 'This signs you out of Hearth on every other device.' : null}
      footer={
        <p className="text-center text-[12px] text-[var(--muted)] mt-5">
          <Link href="/login" className="font-display font-bold text-[var(--accent)]">
            Back to sign in
          </Link>
        </p>
      }
    >
      {usable ? (
        <ResetPasswordForm token={token} minLength={PASSWORD_MIN_LENGTH} />
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorBox>This reset link is invalid, already used, or expired.</ErrorBox>
          <Link href="/forgot-password" className="text-center text-[13px] font-display font-bold text-[var(--accent)]">
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
