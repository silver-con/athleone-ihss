import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getTwoFactorSettings } from '@/lib/queries';
import { emailConfig, smsConfig } from '@/lib/comms/config';
import { ROLE_HOME } from '@/lib/permissions';
import { formatPhone } from '@/lib/comms/phone';
import AuthShell from '@/components/auth/AuthShell';
import TwoFactorForm from './TwoFactorForm';

export const metadata = { title: 'Sign-in security — Athleone' };

export default async function AccountSecurityPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const settings = await getTwoFactorSettings(session.organizationId, session.userId);
  if (!settings) redirect('/login');
  const officeRole = ['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR'].includes(session.role);
  const required = settings.organizationRequiresTwoFactor && officeRole;

  return (
    <AuthShell
      title="Sign-in security"
      subtitle={
        required
          ? 'Your agency requires a one-time code at sign-in for office accounts. Choose where it goes.'
          : 'Add a one-time code at sign-in, so a stolen password alone isn’t enough to get in.'
      }
      footer={
        <div className="flex justify-between text-[12.5px] mt-5 px-1">
          <Link href={ROLE_HOME[session.role] || '/'} className="font-display font-bold text-[var(--accent)]">
            ← Back
          </Link>
          <Link href="/account/password" className="font-display font-bold text-[var(--muted)]">
            Change password
          </Link>
        </div>
      }
    >
      <TwoFactorForm
        method={settings.method}
        mobilePhone={settings.mobilePhone ? formatPhone(settings.mobilePhone) : ''}
        fallbackPhone={settings.caregiverPhone || ''}
        email={settings.email}
        required={required}
        smsLive={smsConfig().live}
        emailLive={emailConfig().live}
      />
    </AuthShell>
  );
}
