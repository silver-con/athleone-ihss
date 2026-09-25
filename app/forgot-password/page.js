import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata = { title: 'Forgot password — Hearth' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter the email you sign in with and we'll send you a link to choose a new one."
      footer={
        <p className="text-center text-[12px] text-[var(--muted)] mt-5">
          Caregivers can also ask the office to reset it.{' '}
          <Link href="/login" className="font-display font-bold text-[var(--accent)]">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
