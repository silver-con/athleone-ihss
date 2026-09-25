const STATUS_STYLE = {
  logged: ['Recorded (not sent)', 'oklch(42% 0.1 75)', 'oklch(95% 0.05 85)'],
  sending: ['Sending', 'oklch(40% 0.08 250)', 'oklch(95% 0.03 250)'],
  sent: ['Sent', 'oklch(40% 0.1 150)', 'oklch(95% 0.05 150)'],
  delivered: ['Delivered', 'oklch(36% 0.11 150)', 'oklch(93% 0.07 150)'],
  undelivered: ['Undelivered', 'oklch(45% 0.14 30)', 'oklch(95% 0.04 30)'],
  failed: ['Failed', 'oklch(45% 0.16 25)', 'oklch(95% 0.04 25)'],
};

const TEMPLATE_LABEL = {
  password_reset: 'Password reset link',
  password_changed: 'Password changed notice',
  sign_in_code: 'Sign-in code',
  welcome: 'Welcome / new account',
  message_to_caregiver: 'New message → caregiver',
  message_to_office: 'New message → office',
  test_email: 'Test email',
  test_sms: 'Test text',
};

export default function OutboxTable({ rows }) {
  if (!rows.length) {
    return <p className="text-[12.5px] text-[var(--muted)] px-1 py-6">Nothing has been sent yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)] font-display">
            <th className="py-2 pr-3">When</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">To</th>
            <th className="py-2 pr-3">Message</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const [label, fg, bg] = STATUS_STYLE[n.status] || [n.status, 'inherit', 'transparent'];
            return (
              <tr key={n.id} className="border-t border-[var(--border)] align-top">
                <td className="py-2.5 pr-3 whitespace-nowrap text-[var(--muted)]">
                  {new Date(n.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap">
                  <span className="font-display font-bold">{n.channel === 'sms' ? 'Text' : 'Email'}</span>
                  <div className="text-[var(--muted)] text-[11.5px]">{TEMPLATE_LABEL[n.template] || n.template}</div>
                </td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px] break-all">{n.recipient}</td>
                <td className="py-2.5 pr-3 max-w-[340px]">
                  {n.subject && <div className="font-display font-bold">{n.subject}</div>}
                  {n.body ? (
                    <div className="text-[var(--muted)] whitespace-pre-wrap line-clamp-3">{n.body}</div>
                  ) : (
                    <div className="text-[var(--muted)] italic">Content hidden — contains a sign-in link or code.</div>
                  )}
                  {n.error && <div className="text-[var(--danger)] mt-1 break-words">{n.error}</div>}
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap">
                  <span className="text-[11px] font-display font-bold rounded-full px-2.5 py-1" style={{ color: fg, background: bg }}>
                    {label}
                  </span>
                  <div className="text-[11px] text-[var(--muted)] mt-1">{n.provider === 'log' ? 'no provider' : n.provider}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
