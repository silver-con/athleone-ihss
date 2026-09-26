// Read-only card: which email/SMS provider is configured, whether it's
// live, and which environment variable NAMES are missing. Never shows a
// key or token — commsStatus() (lib/comms/config.js) doesn't include any.
const SETUP = {
  email: [
    ['SendGrid', 'EMAIL_PROVIDER=sendgrid, SENDGRID_API_KEY, EMAIL_FROM'],
    ['Postmark', 'EMAIL_PROVIDER=postmark, POSTMARK_SERVER_TOKEN, EMAIL_FROM'],
    ['Resend', 'EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM'],
    ['Any SMTP (Microsoft 365, Google Workspace, Mailgun…)', 'EMAIL_PROVIDER=smtp, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM'],
  ],
  sms: [['Twilio', 'SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER']],
};

export default function ProviderStatusCard({ kind, status }) {
  const title = kind === 'email' ? 'Email' : 'Text messages (SMS)';
  const tone = status.live
    ? { bg: 'oklch(95% 0.05 150)', border: 'oklch(85% 0.07 150)', fg: 'oklch(40% 0.1 150)', label: 'Connected' }
    : status.provider !== 'log' || status.unknownProvider
      ? { bg: 'oklch(95% 0.04 30)', border: 'oklch(85% 0.07 30)', fg: 'oklch(45% 0.14 30)', label: 'Incomplete setup' }
      : { bg: 'oklch(95% 0.05 85)', border: 'oklch(86% 0.06 85)', fg: 'oklch(42% 0.1 75)', label: 'Not connected' };

  return (
    <section className="flex-1 min-w-[300px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="font-display font-extrabold text-[15px]">{title}</div>
        <span
          className="text-[11px] font-display font-bold uppercase tracking-wide rounded-full px-2.5 py-1 border"
          style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
        >
          {tone.label}
        </span>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 mt-3 text-[12.5px]">
        <dt className="text-[var(--muted)]">Provider</dt>
        <dd className="font-display font-bold">{status.unknownProvider ? `"${status.requested}" (not recognised)` : status.label}</dd>
        <dt className="text-[var(--muted)]">Sends from</dt>
        <dd className="font-mono text-[12px] break-all">{status.from || '—'}</dd>
      </dl>
      {status.missing.length > 0 && (
        <p className="text-[12.5px] mt-3" style={{ color: tone.fg }}>
          Missing: <span className="font-mono text-[12px]">{status.missing.join(', ')}</span>
        </p>
      )}
      {!status.live && (
        <details className="mt-3 text-[12.5px] text-[var(--muted)]">
          <summary className="cursor-pointer font-display font-bold text-[var(--text)]">How to connect</summary>
          <p className="mt-2">
            Add these to the server&rsquo;s environment (the <span className="font-mono">.env</span> file, or your
            DigitalOcean app settings), then restart Athleone:
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {SETUP[kind].map(([name, vars]) => (
              <li key={name}>
                <strong className="text-[var(--text)]">{name}:</strong> <span className="font-mono text-[11.5px]">{vars}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">Until then every message is still written to the outbox below, so you can see exactly what would have gone out.</p>
        </details>
      )}
    </section>
  );
}
