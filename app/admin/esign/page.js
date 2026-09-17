import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getDocusignCredentials } from '@/lib/queries';
import StatTile from '@/components/StatTile';
import DocusignCredentialsForm from '@/components/admin/DocusignCredentialsForm';
import DocusignTestButton from '@/components/admin/DocusignTestButton';

const ENV_LABEL = { demo: 'Demo / Developer', production: 'Production' };

export default async function EsignSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/admin');

  const credentials = await getDocusignCredentials(session.organizationId);

  return (
    <div>
      <h1 className="font-display font-extrabold text-[24px]">E-Signature (DocuSign)</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1 max-w-[720px]">
        Unlike the state EVV connection, DocuSign&rsquo;s developer/demo environment is free and
        self-serve — no third party has to sponsor access. Create a free account at{' '}
        <span className="font-mono text-[12px]">developers.docusign.com</span>, generate an Integration
        Key and RSA keypair under Apps and Keys, and enter them below.
      </p>

      {!credentials && (
        <div className="bg-[oklch(94%_0.05_85)] border border-[oklch(85%_0.06_85)] rounded-2xl px-5 py-4 mt-6">
          <div className="font-display font-extrabold text-[13.5px] text-[oklch(42%_0.1_75)]">
            Not connected
          </div>
          <p className="text-[12.5px] text-[oklch(42%_0.1_75)] mt-1">
            Caregivers will see a plain checklist item for signing their onboarding packet instead of a
            working &ldquo;start signing&rdquo; button until this is connected.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={credentials ? ENV_LABEL[credentials.environment] : '—'} label="Environment" />
        <StatTile num={credentials?.status || 'not started'} label="Status" />
        <StatTile
          num={credentials?.baaOnFile ? 'Yes' : 'No'}
          label="BAA on file"
          accent={credentials?.baaOnFile ? undefined : 'oklch(58% 0.13 55)'}
        />
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display font-extrabold text-[14.5px]">Connection</div>
            <p className="text-[12.5px] text-[var(--muted)] mt-1">
              {credentials?.lastSuccessAt
                ? `Last successful contact ${new Date(credentials.lastSuccessAt).toLocaleString('en-US')}`
                : 'No successful contact yet.'}
            </p>
          </div>
          <DocusignTestButton configured={Boolean(credentials)} />
        </div>
      </div>

      <DocusignCredentialsForm credentials={credentials} />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        <div className="font-display font-extrabold text-[14.5px] mb-2">What&rsquo;s wired up</div>
        <ul className="text-[12.5px] text-[var(--muted)] list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-[var(--text)]">Onboarding packet</strong> (confidentiality, handbook,
            Hepatitis B — no client PHI): once connected, a caregiver&rsquo;s onboarding checklist gets a
            real &ldquo;Start signing&rdquo; button that opens embedded DocuSign signing and reports back
            automatically.
          </li>
          <li>
            <strong className="text-[var(--text)]">Attendant Orientation</strong> (contains client name and
            HHSC individual number): the send button exists on each orientation&rsquo;s page, but stays
            blocked until &ldquo;BAA on file&rdquo; above is checked.
          </li>
        </ul>
      </div>
    </div>
  );
}
