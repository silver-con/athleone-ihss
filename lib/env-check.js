// Startup check of the server's environment variables — run once by
// instrumentation.js before the app takes requests. Answers the recurring
// "works on my laptop, 500s on the server" problem (see TROUBLESHOOTING.md:
// four incidents in two days were a missing or placeholder env var).
//
// Problems that make the app unsafe or unusable stop a PRODUCTION server
// from starting, with a message naming the variable. In development they
// only warn. Optional integrations (email, SMS) just report their mode.
import { emailConfig, smsConfig, appBaseUrl } from './comms/config.js';

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
  // Fax Inbox storage: Cloud Run's disk is wiped on every restart.
  if (env.K_SERVICE && (env.STORAGE_DRIVER || 'local').toLowerCase() !== 'gcs') {
    errors.push('Running on Cloud Run with STORAGE_DRIVER=local — fax files would be lost on every restart. Set STORAGE_DRIVER=gcs and GCS_BUCKET.');
  }
  if ((env.STORAGE_DRIVER || '').toLowerCase() === 'gcs' && !env.GCS_BUCKET) errors.push('STORAGE_DRIVER=gcs needs GCS_BUCKET.');
  if ((env.DOCAI_PROVIDER || '').toLowerCase() === 'google') {
    const miss = ['GOOGLE_CLOUD_PROJECT', 'DOCAI_PROCESSOR_ID'].filter((k) => !env[k]);
    if (miss.length) warnings.push(`DOCAI_PROVIDER=google but ${miss.join(', ')} missing — faxes can't be read until it's set.`);
  }
  info.push(`fax reading: ${(env.DOCAI_PROVIDER || 'demo').toLowerCase() === 'google' ? 'Google Document AI' : 'demo (typed PDFs only)'}`);
  if (e.unknownProvider) warnings.push(`EMAIL_PROVIDER "${e.requested}" is not one of log, smtp, sendgrid, postmark, resend.`);
  if (s.unknownProvider) warnings.push(`SMS_PROVIDER "${s.requested}" is not one of log, twilio.`);
  if (!e.unknownProvider && e.provider !== 'log' && !e.live) warnings.push(`EMAIL_PROVIDER=${e.provider} but ${e.missing.join(', ')} missing — email falls back to log only.`);
  if (!s.unknownProvider && s.provider !== 'log' && !s.live) warnings.push(`SMS_PROVIDER=${s.provider} but ${s.missing.join(', ')} missing — texts fall back to log only.`);

  return { errors, warnings, info, prod };
}
