import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { logoutAction } from '@/actions/auth';
import { PASSWORD_MIN_LENGTH } from '@/lib/passwords';
import ChangePasswordForm from './ChangePasswordForm';

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const forced = Boolean(session.mustChangePassword);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-7">
          <h1 className="font-display font-extrabold text-[19px] mb-1">
            {forced ? 'Set your own password' : 'Change password'}
          </h1>
          <p className="text-[13px] text-[var(--muted)] mb-6">
            {forced
              ? 'You signed in with a password someone else set for you. Choose your own before continuing — only you should know it.'
              : 'Changing your password signs you out everywhere else.'}
          </p>
          <ChangePasswordForm minLength={PASSWORD_MIN_LENGTH} />
        </div>
        <form action={logoutAction} className="text-center mt-5">
          <button type="submit" className="text-[12.5px] font-display font-bold text-[var(--muted)]">
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
