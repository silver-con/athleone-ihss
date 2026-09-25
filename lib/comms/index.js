// sendEmail / sendSms — the only two functions the rest of the app calls to
// send anything. Server-side only.
//
// Every call:
//   1. writes a row to `notifications` (the outbox on /admin/communications)
//      — body omitted for sensitive messages (reset links, sign-in codes);
//   2. delivers through the configured provider, or with none configured
//      ("log" mode) prints to the server log instead;
//   3. records the outcome (sent / failed + the provider's error text).
//
// They NEVER throw. A notification is a side effect of some real action
// (an office reply, a password reset request); if Twilio is down, the
// office's reply must still be saved. Callers get { ok, id, status, error }
// and decide whether to tell the user.
import { emailConfig, smsConfig, appBaseUrl } from '@/lib/comms/config';
import { EMAIL_SENDERS, SMS_SENDERS, parseAddress } from '@/lib/comms/providers';
import { toE164 } from '@/lib/comms/phone';
import { recordNotification, updateNotificationOutcome } from '@/lib/queries';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function logLine(kind, fields) {
  // One line per message in the server log. Sensitive bodies are printed
  // ONLY in log mode (nothing was delivered, so the log is the only way to
  // test a reset link locally) and never once a real provider is live.
  console.log(`[comms] ${kind} ${JSON.stringify(fields)}`);
}

export async function sendEmail({
  organizationId = null,
  userId = null,
  to,
  template,
  subject,
  text,
  html,
  sensitive = false,
  fromName,
}) {
  const cfg = emailConfig();
  const recipient = String(to || '').trim();
  if (!EMAIL_RE.test(recipient)) return { ok: false, status: 'failed', error: 'No valid email address.' };

  const provider = cfg.live ? cfg.provider : 'log';
  let id = null;
  try {
    id = await recordNotification(organizationId, {
      channel: 'email',
      recipient,
      template,
      subject,
      body: sensitive ? null : text,
      provider,
      status: provider === 'log' ? 'logged' : 'sending',
      userId,
    });
  } catch (err) {
    // The outbox is a record, not a gate — still try to deliver.
    console.error('[comms] could not record notification:', err.message);
  }

  if (provider === 'log') {
    logLine('email (not sent — no provider connected)', { to: recipient, template, subject, ...(sensitive ? { text } : {}) });
    return { ok: true, id, status: 'logged' };
  }

  const from = parseAddress(cfg.from);
  if (fromName) from.name = fromName;
  try {
    const { providerMessageId } = await EMAIL_SENDERS[provider](cfg, {
      to: recipient,
      from,
      replyTo: cfg.replyTo,
      subject,
      text,
      html,
    });
    if (id) await updateNotificationOutcome(id, { status: 'sent', providerMessageId });
    logLine('email sent', { to: recipient, template, provider, providerMessageId });
    return { ok: true, id, status: 'sent' };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 500);
    if (id) await updateNotificationOutcome(id, { status: 'failed', error }).catch(() => {});
    console.error(`[comms] email to ${recipient} failed via ${provider}: ${error}`);
    return { ok: false, id, status: 'failed', error };
  }
}

export async function sendSms({ organizationId = null, userId = null, to, template, body, sensitive = false }) {
  const cfg = smsConfig();
  const recipient = toE164(to);
  if (!recipient) return { ok: false, status: 'failed', error: 'No valid mobile number.' };

  const provider = cfg.live ? cfg.provider : 'log';
  let id = null;
  try {
    id = await recordNotification(organizationId, {
      channel: 'sms',
      recipient,
      template,
      subject: null,
      body: sensitive ? null : body,
      provider,
      status: provider === 'log' ? 'logged' : 'sending',
      userId,
    });
  } catch (err) {
    console.error('[comms] could not record notification:', err.message);
  }

  if (provider === 'log') {
    logLine('sms (not sent — no provider connected)', { to: recipient, template, ...(sensitive ? { body } : { chars: body.length }) });
    return { ok: true, id, status: 'logged' };
  }

  // Delivery receipts: Twilio calls this back as the text moves from
  // sent -> delivered (or undelivered/failed). Only when there's a public
  // https address for it to reach.
  const base = appBaseUrl();
  const statusCallback = base && base.startsWith('https://') ? `${base}/api/webhooks/twilio/status` : undefined;

  try {
    const { providerMessageId } = await SMS_SENDERS[provider](cfg, { to: recipient, body, statusCallback });
    if (id) await updateNotificationOutcome(id, { status: 'sent', providerMessageId });
    logLine('sms sent', { to: recipient, template, provider, providerMessageId });
    return { ok: true, id, status: 'sent' };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 500);
    if (id) await updateNotificationOutcome(id, { status: 'failed', error }).catch(() => {});
    console.error(`[comms] sms to ${recipient} failed via ${provider}: ${error}`);
    return { ok: false, id, status: 'failed', error };
  }
}

// Link builder for emails/texts. Prefers APP_BASE_URL (set in production);
// falls back to the address the current request came in on.
export function absoluteUrl(path, requestBase) {
  const base = appBaseUrl() || requestBase || 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}
