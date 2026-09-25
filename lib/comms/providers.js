// The actual delivery calls, one function per provider. Each takes the
// resolved config (lib/comms/config.js) and a message, and either returns
// { providerMessageId } or throws an Error with a readable message. Nothing
// here touches the database — lib/comms/index.js records the outcome.
//
// HTTP providers are called with plain fetch (same no-SDK approach as
// lib/docusign.js and lib/hhaexchange.js). SMTP uses nodemailer, the one
// dependency this adds, because SMTP is a socket protocol, not HTTP.

const TIMEOUT_MS = 15_000;

async function postJson(url, { headers, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

// "Agency Name <x@y>" / "x@y" -> { name, email }
export function parseAddress(value) {
  const s = String(value || '').trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || undefined, email: m[2].trim() };
  return { name: undefined, email: s };
}

function formatAddress({ name, email }) {
  if (!name) return email;
  return `"${name.replace(/"/g, "'")}" <${email}>`;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

let smtpTransport = null;
let smtpKey = null;

async function sendSmtp(cfg, msg) {
  const key = JSON.stringify(cfg.smtp);
  if (!smtpTransport || smtpKey !== key) {
    const nodemailer = (await import('nodemailer')).default;
    smtpTransport = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    smtpKey = key;
  }
  const info = await smtpTransport.sendMail({
    from: formatAddress(msg.from),
    to: msg.to,
    replyTo: msg.replyTo || undefined,
    subject: msg.subject,
    text: msg.text,
    html: msg.html || undefined,
  });
  return { providerMessageId: info.messageId || null };
}

async function sendSendgrid(cfg, msg) {
  const { res, text } = await postJson('https://api.sendgrid.com/v3/mail/send', {
    headers: { Authorization: `Bearer ${cfg.sendgridKey}` },
    body: {
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from.email, ...(msg.from.name ? { name: msg.from.name } : {}) },
      ...(msg.replyTo ? { reply_to: parseAddress(msg.replyTo) } : {}),
      subject: msg.subject,
      content: [
        { type: 'text/plain', value: msg.text },
        ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
      ],
    },
  });
  if (res.status !== 202 && !res.ok) throw new Error(`SendGrid rejected the message (HTTP ${res.status}) ${text.slice(0, 300)}`);
  return { providerMessageId: res.headers.get('x-message-id') };
}

async function sendPostmark(cfg, msg) {
  const { res, json, text } = await postJson('https://api.postmarkapp.com/email', {
    headers: { 'X-Postmark-Server-Token': cfg.postmarkToken },
    body: {
      From: formatAddress(msg.from),
      To: msg.to,
      ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}),
      Subject: msg.subject,
      TextBody: msg.text,
      ...(msg.html ? { HtmlBody: msg.html } : {}),
      MessageStream: 'outbound',
    },
  });
  if (!res.ok || (json && json.ErrorCode)) {
    throw new Error(`Postmark rejected the message (HTTP ${res.status}) ${json?.Message || text.slice(0, 300)}`);
  }
  return { providerMessageId: json?.MessageID || null };
}

async function sendResend(cfg, msg) {
  const { res, json, text } = await postJson('https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${cfg.resendKey}` },
    body: {
      from: formatAddress(msg.from),
      to: [msg.to],
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    },
  });
  if (!res.ok) throw new Error(`Resend rejected the message (HTTP ${res.status}) ${json?.message || text.slice(0, 300)}`);
  return { providerMessageId: json?.id || null };
}

export const EMAIL_SENDERS = { smtp: sendSmtp, sendgrid: sendSendgrid, postmark: sendPostmark, resend: sendResend };

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

async function sendTwilio(cfg, msg) {
  const { accountSid, authToken, from, messagingServiceSid } = cfg.twilio;
  const form = new URLSearchParams({ To: msg.to, Body: msg.body });
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);
  if (msg.statusCallback) form.set('StatusCallback', msg.statusCallback);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    // Twilio error codes are documented at twilio.com/docs/api/errors/<code>
    const hint = json?.code ? ` (Twilio error ${json.code})` : '';
    throw new Error(`Twilio rejected the text${hint}: ${json?.message || text.slice(0, 300)}`);
  }
  return { providerMessageId: json?.sid || null };
}

export const SMS_SENDERS = { twilio: sendTwilio };
