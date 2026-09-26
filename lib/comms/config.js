// Email + SMS configuration, read from environment variables.
//
// Hearth sends email and text messages on behalf of every agency on the
// platform from ONE set of provider accounts (the normal SaaS pattern — the
// same way Hearth holds one DigitalOcean account, not one per agency). Each
// agency's name goes in the From display name and the message body.
//
// Nothing here is required. With no provider configured, EMAIL_PROVIDER and
// SMS_PROVIDER default to "log": every message is still built, recorded in
// the notifications table (the Communications page's outbox) and printed to
// the server log — it just isn't delivered. That keeps every feature
// demonstrable before any account is connected.
//
// To connect a real provider, set the variables below in .env (locally) or
// the server's environment (DigitalOcean) and restart. The Communications
// page (/admin/communications, and /platform/communications for Hearth
// staff) shows what's connected and sends a test message.
//
//   EMAIL_PROVIDER   log | smtp | sendgrid | postmark | resend
//   EMAIL_FROM       e.g. "Hearth <no-reply@yourdomain.com>" — must be an
//                    address/domain your provider has verified
//   EMAIL_REPLY_TO   optional
//     smtp:     SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS,
//               SMTP_SECURE ("true" for port 465)
//     sendgrid: SENDGRID_API_KEY
//     postmark: POSTMARK_SERVER_TOKEN
//     resend:   RESEND_API_KEY
//
//   SMS_PROVIDER     log | twilio
//     twilio:   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
//               TWILIO_FROM_NUMBER (+15125550100) or
//               TWILIO_MESSAGING_SERVICE_SID (MG…)
//
//   APP_BASE_URL     the public address, e.g. https://app.yourdomain.com —
//                    used to build links inside emails/texts and to verify
//                    Twilio webhook signatures
//   NOTIFY_INCLUDE_MESSAGE_TEXT  "true" to put the actual message text in
//                    new-message texts/emails. Default off: the notice just
//                    says a message is waiting, so no PHI travels by SMS or
//                    email (neither is a HIPAA-covered channel by default).

export const EMAIL_PROVIDERS = {
  log: { label: 'Not connected (log only)', required: [] },
  smtp: { label: 'SMTP', required: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] },
  sendgrid: { label: 'SendGrid', required: ['SENDGRID_API_KEY'] },
  postmark: { label: 'Postmark', required: ['POSTMARK_SERVER_TOKEN'] },
  resend: { label: 'Resend', required: ['RESEND_API_KEY'] },
};

export const SMS_PROVIDERS = {
  log: { label: 'Not connected (log only)', required: [] },
  twilio: { label: 'Twilio', required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
};

function clean(v) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

export function emailConfig(env = process.env) {
  const requested = (clean(env.EMAIL_PROVIDER) || 'log').toLowerCase();
  const known = EMAIL_PROVIDERS[requested];
  const provider = known ? requested : 'log';
  const missing = known ? known.required.filter((k) => !clean(env[k])) : [];
  if (provider !== 'log' && !clean(env.EMAIL_FROM)) missing.push('EMAIL_FROM');
  return {
    requested,
    provider,
    unknownProvider: !known,
    label: EMAIL_PROVIDERS[provider].label,
    missing,
    // "live" = will actually try to deliver.
    live: provider !== 'log' && missing.length === 0,
    from: clean(env.EMAIL_FROM) || 'Athleone <no-reply@hearth.local>',
    replyTo: clean(env.EMAIL_REPLY_TO),
    smtp: {
      host: clean(env.SMTP_HOST),
      port: Number(env.SMTP_PORT) || 587,
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(env.SMTP_PORT) === 465,
      user: clean(env.SMTP_USER),
      pass: clean(env.SMTP_PASS),
    },
    sendgridKey: clean(env.SENDGRID_API_KEY),
    postmarkToken: clean(env.POSTMARK_SERVER_TOKEN),
    resendKey: clean(env.RESEND_API_KEY),
  };
}

export function smsConfig(env = process.env) {
  const requested = (clean(env.SMS_PROVIDER) || 'log').toLowerCase();
  const known = SMS_PROVIDERS[requested];
  const provider = known ? requested : 'log';
  const missing = known ? known.required.filter((k) => !clean(env[k])) : [];
  if (provider === 'twilio' && !clean(env.TWILIO_FROM_NUMBER) && !clean(env.TWILIO_MESSAGING_SERVICE_SID)) {
    missing.push('TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
  }
  return {
    requested,
    provider,
    unknownProvider: !known,
    label: SMS_PROVIDERS[provider].label,
    missing,
    live: provider !== 'log' && missing.length === 0,
    twilio: {
      accountSid: clean(env.TWILIO_ACCOUNT_SID),
      authToken: clean(env.TWILIO_AUTH_TOKEN),
      from: clean(env.TWILIO_FROM_NUMBER),
      messagingServiceSid: clean(env.TWILIO_MESSAGING_SERVICE_SID),
    },
  };
}

export function appBaseUrl(env = process.env) {
  const v = clean(env.APP_BASE_URL);
  return v ? v.replace(/\/+$/, '') : null;
}

export function includeMessageText(env = process.env) {
  return String(env.NOTIFY_INCLUDE_MESSAGE_TEXT || '').toLowerCase() === 'true';
}

// Safe to hand to a page: which provider, whether it's live, which variable
// NAMES are missing. Never a key, token or password.
export function commsStatus(env = process.env) {
  const e = emailConfig(env);
  const s = smsConfig(env);
  return {
    email: {
      provider: e.provider,
      requested: e.requested,
      unknownProvider: e.unknownProvider,
      label: e.label,
      live: e.live,
      missing: e.missing,
      from: e.from,
    },
    sms: {
      provider: s.provider,
      requested: s.requested,
      unknownProvider: s.unknownProvider,
      label: s.label,
      live: s.live,
      missing: s.missing,
      from: s.twilio.from || (s.twilio.messagingServiceSid ? 'Messaging Service' : null),
    },
    appBaseUrl: appBaseUrl(env),
    includeMessageText: includeMessageText(env),
  };
}
