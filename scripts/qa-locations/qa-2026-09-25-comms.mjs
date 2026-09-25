// QA for the email/SMS layer (2026-09-25): provider configuration, the
// outbox, sensitive-body redaction, failure handling, Twilio signatures and
// delivery receipts, tenant scoping, and the agency notification settings.
//
// Real providers are never called: globalThis.fetch is replaced with a fake
// that records the request and answers the way SendGrid/Twilio would.
import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { emailConfig, smsConfig, commsStatus } from './comms/config.js';
import { sendEmail, sendSms } from './comms/index.js';
import { toE164, maskPhone, maskEmail } from './comms/phone.js';
import { twilioSignature, isValidTwilioSignature } from './comms/twilio-signature.js';
import * as T from './comms/templates.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}

const ORG = 'org-comms';
const OTHER = 'org-comms-2';
const ENV_KEYS = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'SENDGRID_API_KEY', 'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'TWILIO_MESSAGING_SERVICE_SID', 'APP_BASE_URL', 'SMTP_HOST'];
function resetEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

const realFetch = globalThis.fetch;
let calls = [];
function fakeFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
}
const jsonResponse = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function run() {
  resetEnv();
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Comms Agency','active'), ($2,'Other Agency','active')`, [ORG, OTHER]);

  console.log('\n== configuration ==');
  eq('no env -> email log mode', emailConfig().provider, 'log');
  eq('no env -> sms log mode', smsConfig().provider, 'log');
  check('log mode is not live', !emailConfig().live && !smsConfig().live);
  process.env.EMAIL_PROVIDER = 'sendgrid';
  eq('sendgrid without key lists what is missing', emailConfig().missing, ['SENDGRID_API_KEY', 'EMAIL_FROM']);
  check('  ...and is not live', !emailConfig().live);
  process.env.SENDGRID_API_KEY = 'SG.fake';
  process.env.EMAIL_FROM = 'Hearth <no-reply@example.com>';
  check('sendgrid with key + from is live', emailConfig().live);
  process.env.EMAIL_PROVIDER = 'mailchimp';
  check('an unknown provider falls back to log and says so', emailConfig().provider === 'log' && emailConfig().unknownProvider);
  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'ACfake';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  check('twilio without a from number is not live', !smsConfig().live && smsConfig().missing.some((m) => m.includes('TWILIO_FROM_NUMBER')));
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MGfake';
  check('twilio with a messaging service is live', smsConfig().live);
  const st = JSON.stringify(commsStatus());
  check('commsStatus never contains a key or token', !st.includes('SG.fake') && !st.includes('"tok"') && !st.includes('ACfake'));
  resetEnv();

  console.log('\n== phone numbers ==');
  eq('(512) 555-0147 -> E.164', toE164('(512) 555-0147'), '+15125550147');
  eq('1-512-555-0147 -> E.164', toE164('1-512-555-0147'), '+15125550147');
  eq('+44 20 7946 0958 kept', toE164('+44 20 7946 0958'), '+442079460958');
  eq('garbage -> null', toE164('call me'), null);
  eq('7 digits -> null', toE164('555-0147'), null);
  eq('maskPhone shows last 4', maskPhone('+15125550147'), '•••-•••-0147');
  eq('maskEmail', maskEmail('denise@hearth.demo'), 'd•••@hearth.demo');

  console.log('\n== log mode: recorded, not delivered ==');
  fakeFetch(() => { throw new Error('fetch must not be called in log mode'); });
  const r1 = await sendEmail({ organizationId: ORG, to: 'a@b.test', template: 'test_email', ...T.testEmail({ sentBy: 'QA' }) });
  eq('result is logged', r1.status, 'logged');
  eq('no network call', calls.length, 0);
  let row = await queryOne('SELECT * FROM notifications WHERE id = $1', [r1.id]);
  check('outbox row written with body', row && row.body && row.body.includes('test email'));
  eq('  ...provider log, status logged', [row.provider, row.status], ['log', 'logged']);
  const r2 = await sendEmail({ organizationId: ORG, to: 'a@b.test', template: 'password_reset', ...T.passwordResetEmail({ name: 'A', organizationName: 'Comms Agency', resetUrl: 'https://x/reset?token=SECRET123', minutes: 60 }) });
  row = await queryOne('SELECT * FROM notifications WHERE id = $1', [r2.id]);
  eq('a sensitive message (reset link) is stored WITHOUT its body', row.body, null);
  check('  ...but with its subject', row.subject === 'Reset your Hearth password');
  const bad = await sendEmail({ organizationId: ORG, to: 'not-an-email', template: 'test_email', subject: 's', text: 't' });
  check('an invalid address is refused without a row', !bad.ok && !bad.id);
  const badSms = await sendSms({ organizationId: ORG, to: '12', template: 'test_sms', body: 'x' });
  check('an invalid phone is refused', !badSms.ok);
  const s1 = await sendSms({ organizationId: ORG, to: '512-555-0147', template: 'test_sms', body: 'hello' });
  row = await queryOne('SELECT * FROM notifications WHERE id = $1', [s1.id]);
  eq('sms stored with the E.164 number', row.recipient, '+15125550147');

  console.log('\n== live provider: success ==');
  process.env.EMAIL_PROVIDER = 'sendgrid';
  process.env.SENDGRID_API_KEY = 'SG.fake';
  process.env.EMAIL_FROM = 'Hearth <no-reply@example.com>';
  fakeFetch((url) => {
    if (url.includes('sendgrid')) return new Response('', { status: 202, headers: { 'x-message-id': 'sg-123' } });
    throw new Error('unexpected ' + url);
  });
  const r3 = await sendEmail({ organizationId: ORG, to: 'c@d.test', template: 'test_email', fromName: 'Comms Agency via Hearth', ...T.testEmail({ sentBy: 'QA' }) });
  eq('sent', r3.status, 'sent');
  eq('one call to SendGrid', calls.length, 1);
  const sgBody = JSON.parse(calls[0].init.body);
  eq('  ...to the right person', sgBody.personalizations[0].to[0].email, 'c@d.test');
  eq('  ...from the agency display name', sgBody.from, { email: 'no-reply@example.com', name: 'Comms Agency via Hearth' });
  check('  ...with the API key as a bearer token', calls[0].init.headers.Authorization === 'Bearer SG.fake');
  row = await queryOne('SELECT * FROM notifications WHERE id = $1', [r3.id]);
  eq('  ...outbox row: sent + provider id', [row.status, row.provider, row.provider_message_id], ['sent', 'sendgrid', 'sg-123']);

  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'ACfake';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_FROM_NUMBER = '+15125550100';
  process.env.APP_BASE_URL = 'https://app.example.com';
  fakeFetch((url) => jsonResponse(201, { sid: 'SM123', status: 'queued' }));
  const s2 = await sendSms({ organizationId: ORG, to: '(512) 555-0147', template: 'test_sms', body: 'hi' });
  eq('twilio sms sent', s2.status, 'sent');
  check('  ...to the Messages endpoint for this account', calls[0].url.endsWith('/Accounts/ACfake/Messages.json'));
  const form = new URLSearchParams(calls[0].init.body.toString());
  eq('  ...To/From/Body', [form.get('To'), form.get('From'), form.get('Body')], ['+15125550147', '+15125550100', 'hi']);
  eq('  ...asks for delivery receipts at APP_BASE_URL', form.get('StatusCallback'), 'https://app.example.com/api/webhooks/twilio/status');
  check('  ...basic auth with SID:token', calls[0].init.headers.Authorization === 'Basic ' + Buffer.from('ACfake:tok').toString('base64'));

  console.log('\n== live provider: failure never throws ==');
  fakeFetch(() => jsonResponse(400, { code: 21211, message: "The 'To' number is not a valid phone number." }));
  const s3 = await sendSms({ organizationId: ORG, to: '(512) 555-0199', template: 'test_sms', body: 'x' });
  check('returns ok:false instead of throwing', s3.ok === false && s3.status === 'failed');
  check('  ...error names the Twilio code', /21211/.test(s3.error));
  row = await queryOne('SELECT * FROM notifications WHERE id = $1', [s3.id]);
  eq('  ...outbox row marked failed with the error', [row.status, /21211/.test(row.error)], ['failed', true]);
  fakeFetch(() => { throw new Error('network down'); });
  const r4 = await sendEmail({ organizationId: ORG, to: 'e@f.test', template: 'test_email', subject: 's', text: 't' });
  check('a network error is also contained', r4.ok === false && /network down/.test(r4.error));

  console.log('\n== Twilio signatures and delivery receipts ==');
  const url = 'https://app.example.com/api/webhooks/twilio/status';
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered', To: '+15125550147' };
  const sig = twilioSignature('tok', url, params);
  check('a correct signature verifies', isValidTwilioSignature('tok', url, params, sig));
  check('the wrong token does not', !isValidTwilioSignature('other', url, params, sig));
  check('a tampered parameter does not', !isValidTwilioSignature('tok', url, { ...params, MessageStatus: 'failed' }, sig));
  check('a missing signature does not', !isValidTwilioSignature('tok', url, params, null));
  // Cross-checked against the official twilio npm package's
  // getExpectedTwilioSignature() for these exact inputs (run once, by hand).
  const docParams = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  eq("matches the official Twilio library's signature", twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', docParams), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');

  check('receipt: sent -> delivered', await db.applyDeliveryReceipt('SM123', 'delivered'));
  eq('  ...row is delivered', (await queryOne(`SELECT status FROM notifications WHERE provider_message_id = 'SM123'`)).status, 'delivered');
  check('a late "sent" receipt does not move it backwards', !(await db.applyDeliveryReceipt('SM123', 'sent')));
  check('an unknown SID is ignored', !(await db.applyDeliveryReceipt('SMnope', 'delivered')));

  console.log('\n== tenant scoping ==');
  await sendEmail({ organizationId: OTHER, to: 'x@other.test', template: 'test_email', subject: 'other', text: 'other' });
  await sendEmail({ organizationId: null, to: 'ops@hearth.test', template: 'test_email', subject: 'platform', text: 'platform' });
  const mine = await db.getNotifications(ORG);
  check("an agency's outbox holds only its own rows", mine.length > 0 && mine.every((n) => n.organizationId === ORG));
  check('  ...never the other agency or platform mail', !mine.some((n) => n.recipient === 'x@other.test' || n.recipient === 'ops@hearth.test'));
  await throws('getNotifications refuses a missing organizationId', () => db.getNotifications(null));
  const counts = await db.getNotificationCounts(ORG);
  check('counts by channel/status', counts.email.logged >= 1 && counts.sms.failed === 1);
  const summary = await db.getPlatformNotificationSummary();
  check('platform summary carries counts, not recipients or bodies', summary.length > 0 && summary.every((r) => !('recipient' in r) && !('body' in r)));

  console.log('\n== agency notification settings ==');
  await db.updateOrganizationCommsSettings(ORG, { notifyEmail: ' Office@Agency.test ', caregiverNotifyChannel: 'both' });
  let org = await db.getOrganization(ORG);
  eq('office email saved, trimmed and lower-cased', org.notifyEmail, 'office@agency.test');
  eq('channel saved', org.caregiverNotifyChannel, 'both');
  await throws('a bad office email is refused', () => db.updateOrganizationCommsSettings(ORG, { notifyEmail: 'nope', caregiverNotifyChannel: 'sms' }), 'valid office email');
  await throws('an unknown channel is refused', () => db.updateOrganizationCommsSettings(ORG, { notifyEmail: '', caregiverNotifyChannel: 'pigeon' }));
  await db.updateOrganizationCommsSettings(ORG, { notifyEmail: '', caregiverNotifyChannel: 'none' });
  org = await db.getOrganization(ORG);
  eq('blank clears the office email', [org.notifyEmail, org.caregiverNotifyChannel], [null, 'none']);
  eq('a new agency defaults to texting caregivers', (await db.getOrganization(OTHER)).caregiverNotifyChannel, 'sms');

  console.log('\n== templates carry no PHI and escape HTML ==');
  const w = T.welcomeEmail({ name: '<b>x</b>', organizationName: 'A&B Care', email: 'n@x.test', loginUrl: 'https://app/login', role: 'CAREGIVER' });
  check('html escapes the name', w.html.includes('&lt;b&gt;x&lt;/b&gt;') && !w.html.includes('<b>x</b>'));
  check('html escapes the agency name', w.html.includes('A&amp;B Care'));
  const n1 = T.newMessageForCaregiverSms({ organizationName: 'A', preview: null, url: 'https://app/caregiver/messages' });
  check('default new-message text says only that a message is waiting', n1.body === 'A sent you a message in Hearth. Read it: https://app/caregiver/messages');
  eq('previewOf trims to one line', T.previewOf('line one\n\nline   two'), 'line one line two');
  check('previewOf caps length', T.previewOf('x'.repeat(300)).length === 140);
}

run().then(async () => {
  globalThis.fetch = realFetch;
  console.log('\n' + '='.repeat(60));
  console.log(`COMMS RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
