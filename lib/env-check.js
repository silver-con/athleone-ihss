// Startup check of the server's environment variables — run once by
// instrumentation.js before the app takes requests. Answers the recurring
// "works on my laptop, 500s on the server" problem (see TROUBLESHOOTING.md:
// four incidents in two days were a missing or placeholder env var).
//
// Problems that make the app unsafe or unusable stop a PRODUCTION server
// from starting, with a message naming the variable. In development they
// only warn. Optional integrations (email, SMS) just report their mode.
import { emailConfig, smsConfig, appBaseUrl } from './comms/config.js';
import { storageConfig } from './storage.js';

const PLACEHOLDER = /replace-this|changeme|your-|example|dev-only/i;

export function checkEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const prod = env.NODE_ENV === 'production';

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set — the Postgres connection string.');

  const secret = env.SESSION_SECRET || '';
  if (!secret) errors.push('SESSION_SECRET is not set. Generate one: openssl rand -hex 32');
  else if (secret.length < 32) errors.push('SESSION_SECRET is shorter than 32 characters. Generate one: openssl rand -hex 32');
  else if (prod && PLACEHOLDER.test(secret)) errors.push('SESSION_SECRET is still a placeholder value. Generate one: openssl rand -hex 32');

  const key = env.EVV_CREDENTIALS_KEY || '';
  if (!key) errors.push('EVV_CREDENTIALS_KEY is not set (encrypts DocuSign/EVV credentials). Generate one: openssl rand -hex 32');
  else if (!/^[0-9a-fA-F]{64}$/.test(key)) errors.push('EVV_CREDENTIALS_KEY must be 64 hex characters. Generate one: openssl rand -hex 32');

  const base = appBaseUrl(env);
  if (prod && !base) {
    warnings.push('APP_BASE_URL is not set — password-reset and welcome emails are NOT sent in production without it (links would otherwise come from the request Host header), and Twilio/DocuSign webhooks cannot be verified.');
  } else if (prod && base && !base.startsWith('https://')) {
    warnings.push(`APP_BASE_URL is ${base} — use https:// in production.`);
  }

  if (prod && String(env.COOKIE_SECURE || '').toLowerCase() === 'false') {
    warnings.push('COOKIE_SECURE=false — sign-in cookies are sent over plain http. Only for a temporary demo without HTTPS.');
  }

  const e = emailConfig(env);
  const s = smsConfig(env);
  const info = [
    `email: ${e.live ? `${e.provider} (live)` : e.provider === 'log' ? 'not connected (log only)' : `${e.requested} — missing ${e.missing.join(', ')}`}`,
    `sms: ${s.live ? `${s.provider} (live)` : s.provider === 'log' ? 'not connected (log only)' : `${s.requested} — missing ${s.missing.join(', ')}`}`,
  ];
  if (prod && !e.live) {
    warnings.push('Email is not connected: forgot-password, welcome emails and two-step sign-in codes are switched off on this server until it is (see Communications).');
  }
  // Fax Inbox storage and reading. Google Cloud Storage / Document AI were
  // removed on 2026-09-28; an old setting must not quietly fall back.
  const storage = storageConfig(env);
  if (!storage.driver) errors.push(`STORAGE_DRIVER=${storage.requested} is no longer available — fax files can only be kept on local disk (a mounted volume) for now. Remove the setting.`);
  // (Kept in step with docaiStatus() in lib/docai — not imported here so the
  // startup check doesn't load the PDF reader.)
  const reader = (env.DOCAI_PROVIDER || 'demo').toLowerCase();
  if (reader !== 'demo') warnings.push(`DOCAI_PROVIDER=${reader} is no longer available — faxes are read in demo mode (typed PDFs only). Remove the setting.`);
  const leftover = ['GOOGLE_CLOUD_PROJECT', 'DOCAI_PROCESSOR_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GCS_BUCKET'].filter((k) => env[k]);
  if (leftover.length) warnings.push(`${leftover.join(', ')} ${leftover.length > 1 ? 'are' : 'is'} set but no longer used (Google services were removed). Remove ${leftover.length > 1 ? 'them' : 'it'}.`);
  info.push('fax reading: demo (typed PDFs only)');
  if (e.unknownProvider) warnings.push(`EMAIL_PROVIDER "${e.requested}" is not one of log, smtp, sendgrid, postmark, resend.`);
  if (s.unknownProvider) warnings.push(`SMS_PROVIDER "${s.requested}" is not one of log, twilio.`);
  if (!e.unknownProvider && e.provider !== 'log' && !e.live) warnings.push(`EMAIL_PROVIDER=${e.provider} but ${e.missing.join(', ')} missing — email falls back to log only.`);
  if (!s.unknownProvider && s.provider !== 'log' && !s.live) warnings.push(`SMS_PROVIDER=${s.provider} but ${s.missing.join(', ')} missing — texts fall back to log only.`);

  return { errors, warnings, info, prod };
}
