// Every email/text Hearth sends is built here, so wording lives in one
// place and nothing PHI-bearing slips into a template by accident.
//
// RULE: no client names, diagnoses, Medicaid IDs, addresses or visit
// details in any template. Email and SMS are not HIPAA-covered channels
// unless the agency has a BAA with the provider AND the provider is
// configured for it. Notices say "something is waiting — sign in to see
// it". The one opt-in exception is NOTIFY_INCLUDE_MESSAGE_TEXT (see
// lib/comms/config.js), which the agency turns on knowingly.
//
// Each email template returns { subject, text, html }; each SMS template
// returns { body }. `sensitive: true` marks messages carrying a secret (a
// reset link, a sign-in code) — lib/comms/index.js never stores their body.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A deliberately plain HTML wrapper — renders the same in Gmail, Outlook
// and phone mail apps, no images or external CSS.
function layout({ heading, paragraphs, button, footer }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#2b2a28">${p}</p>`).join('');
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#23776d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:15px">${esc(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#77736d;word-break:break-all">Or paste this into your browser: ${esc(button.href)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td>
<div style="font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#23776d;margin-bottom:10px">Hearth</div>
<h1 style="margin:0 0 16px;font-size:20px;color:#2b2a28">${esc(heading)}</h1>
${body}${btn}
<p style="margin:22px 0 0;font-size:12px;color:#77736d">${footer || 'You received this because you have an account on Hearth.'}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function agencyName(org) {
  return (org && org.trim()) || 'your agency';
}

export function passwordResetEmail({ name, organizationName, resetUrl, minutes }) {
  const agency = agencyName(organizationName);
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Someone asked to reset the password for your ${agency} account on Hearth. If that was you, open this link within ${minutes} minutes:`,
    '',
    resetUrl,
    '',
    "If you didn't ask for this, ignore this email — your password stays the same. The link works once.",
  ].join('\n');
  return {
    subject: 'Reset your Hearth password',
    text,
    html: layout({
      heading: 'Reset your password',
      paragraphs: [
        `Hi ${esc(name || 'there')},`,
        `Someone asked to reset the password for your ${esc(agency)} account on Hearth. If that was you, use the button below within ${minutes} minutes.`,
      ],
      button: { label: 'Choose a new password', href: resetUrl },
      footer: "Didn't ask for this? Ignore this email — your password stays the same. The link works once.",
    }),
    sensitive: true,
  };
}

export function passwordChangedEmail({ name, organizationName }) {
  const agency = agencyName(organizationName);
  const text = `Hi ${name || 'there'},\n\nThe password for your ${agency} account on Hearth was just changed. If this wasn't you, contact your agency office right away.`;
  return {
    subject: 'Your Hearth password was changed',
    text,
    html: layout({
      heading: 'Your password was changed',
      paragraphs: [
        `Hi ${esc(name || 'there')},`,
        `The password for your ${esc(agency)} account on Hearth was just changed.`,
        "If this wasn't you, contact your agency office right away.",
      ],
    }),
  };
}

export function signInCodeEmail({ name, code, minutes }) {
  return {
    subject: `${code} is your Hearth sign-in code`,
    text: `Hi ${name || 'there'},\n\nYour Hearth sign-in code is ${code}. It expires in ${minutes} minutes.\n\nIf you weren't signing in, change your password — someone may know it.`,
    html: layout({
      heading: 'Your sign-in code',
      paragraphs: [
        `Hi ${esc(name || 'there')},`,
        `Your Hearth sign-in code is <strong style="font-size:22px;letter-spacing:.18em">${esc(code)}</strong>`,
        `It expires in ${minutes} minutes.`,
      ],
      footer: "Weren't signing in? Change your password — someone may know it.",
    }),
    sensitive: true,
  };
}

export function signInCodeSms({ code, minutes }) {
  return { body: `Hearth sign-in code: ${code}. Expires in ${minutes} min. Don't share it with anyone.`, sensitive: true };
}

export function welcomeEmail({ name, organizationName, email, loginUrl, role }) {
  const agency = agencyName(organizationName);
  const roleLine =
    role === 'CAREGIVER'
      ? 'You can see your visits, clock in and out, and message the office from your phone.'
      : 'You can sign in from any browser.';
  return {
    subject: `Your ${agency} account on Hearth is ready`,
    text: [
      `Hi ${name || 'there'},`,
      '',
      `${agency} created a Hearth account for you. ${roleLine}`,
      '',
      `Sign in: ${loginUrl}`,
      `Email: ${email}`,
      '',
      'Your office will give you your starting password separately. You will choose your own the first time you sign in.',
    ].join('\n'),
    html: layout({
      heading: `Welcome to ${agency}`,
      paragraphs: [
        `Hi ${esc(name || 'there')},`,
        `${esc(agency)} created a Hearth account for you. ${esc(roleLine)}`,
        `Sign in with <strong>${esc(email)}</strong>. Your office will give you your starting password separately — you'll choose your own the first time you sign in.`,
      ],
      button: { label: 'Sign in to Hearth', href: loginUrl },
    }),
  };
}

// Office -> caregiver
export function newMessageForCaregiverSms({ organizationName, preview, url }) {
  const agency = agencyName(organizationName);
  const body = preview
    ? `${agency}: ${preview}${url ? `\nReply in Hearth: ${url}` : ''}`
    : `${agency} sent you a message in Hearth.${url ? ` Read it: ${url}` : ' Open the app to read it.'}`;
  return { body: body.slice(0, 480) };
}

export function newMessageForCaregiverEmail({ name, organizationName, preview, url }) {
  const agency = agencyName(organizationName);
  return {
    subject: `New message from ${agency}`,
    text: `Hi ${name || 'there'},\n\n${agency} sent you a message in Hearth.${preview ? `\n\n"${preview}"` : ''}\n\n${url ? `Read and reply: ${url}` : 'Open Hearth to read and reply.'}`,
    html: layout({
      heading: `New message from ${agency}`,
      paragraphs: [
        `Hi ${esc(name || 'there')},`,
        `${esc(agency)} sent you a message in Hearth.`,
        ...(preview ? [`<em>&ldquo;${esc(preview)}&rdquo;</em>`] : []),
      ],
      button: url ? { label: 'Read and reply', href: url } : null,
    }),
  };
}

// Caregiver -> office (to the agency's notification email)
export function newMessageForOfficeEmail({ caregiverName, preview, url }) {
  return {
    subject: `New message from ${caregiverName || 'a caregiver'}`,
    text: `${caregiverName || 'A caregiver'} sent the office a message in Hearth.${preview ? `\n\n"${preview}"` : ''}\n\n${url ? `Reply: ${url}` : ''}`,
    html: layout({
      heading: `New message from ${caregiverName || 'a caregiver'}`,
      paragraphs: [`${esc(caregiverName || 'A caregiver')} sent the office a message in Hearth.`, ...(preview ? [`<em>&ldquo;${esc(preview)}&rdquo;</em>`] : [])],
      button: url ? { label: 'Open Messages', href: url } : null,
      footer: "You're getting this because this address is set as your agency's notification email in Hearth.",
    }),
  };
}

export function testEmail({ sentBy }) {
  return {
    subject: 'Hearth test email',
    text: `This is a test email from Hearth, sent by ${sentBy}. If you're reading it, email delivery works.`,
    html: layout({
      heading: 'Email delivery works',
      paragraphs: [`This is a test email from Hearth, sent by ${esc(sentBy)}.`, "If you're reading it, email is connected correctly."],
    }),
  };
}

export function testSms({ sentBy }) {
  return { body: `Hearth test text sent by ${sentBy}. If you got this, texting works.` };
}

// First ~140 chars of a message, one line — only used when the agency has
// opted in with NOTIFY_INCLUDE_MESSAGE_TEXT.
export function previewOf(text, max = 140) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}
