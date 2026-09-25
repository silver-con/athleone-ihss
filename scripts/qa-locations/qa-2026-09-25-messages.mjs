// QA for the office Messages inbox, message notifications and inbound SMS
// (2026-09-25). Email/SMS run in log mode; outcomes are read from the
// notifications table.
for (const k of ['EMAIL_PROVIDER', 'SMS_PROVIDER', 'APP_BASE_URL', 'NOTIFY_INCLUDE_MESSAGE_TEXT']) delete process.env[k];

import * as db from './queries.js';
import { query, queryOne, pool } from './db.js';
import { notifyCaregiverOfOfficeMessage, notifyOfficeOfCaregiverMessage } from './messaging.js';
import { handleInboundSms, twiml, UNMATCHED_REPLY, MATCHED_REPLY } from './inbound-sms.js';
import { formatMessageTime } from './format-time.js';

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
const origLog = console.log;
console.log = (...a) => { if (String(a[0]).startsWith('[comms]')) return; origLog(...a); };

const ORG = 'org-msg';
const OTHER = 'org-msg-2';
const notes = (template) => query(`SELECT * FROM notifications WHERE organization_id = $1 AND template = $2 ORDER BY created_at`, [ORG, template]);

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Message Agency','active'), ($2,'Second Agency','active')`, [ORG, OTHER]);
  const north = await db.createLocation(ORG, { name: 'North' });
  const south = await db.createLocation(ORG, { name: 'South' });
  const other = await db.createLocation(OTHER, { name: 'Main' });
  await query(
    `INSERT INTO caregivers (id, organization_id, name, role, phone, email, status, location_id) VALUES
     ('m-cg1',$1,'Ana North','Aide','(512) 555-0101','ana@msg.test','active',$2),
     ('m-cg2',$1,'Ben South','Aide','512.555.0102',NULL,'active',$3),
     ('m-cg3',$1,'Cal Nophone','Aide','','cal@msg.test','active',$2),
     ('m-cg4',$1,'Dee Gone','Aide','512-555-0104',NULL,'inactive',$2),
     ('m-cg5',$4,'Eve Elsewhere','Aide','512-555-0105',NULL,'active',$5),
     ('m-cg6',$1,'Twin One','Aide','512-555-0199',NULL,'active',$2),
     ('m-cg7',$4,'Twin Two','Aide','+1 512 555 0199',NULL,'active',$5)`,
    [ORG, north, south, OTHER, other]
  );

  console.log('\n== sending and scoping ==');
  const id1 = await db.sendCaregiverMessage(ORG, 'm-cg1', 'Ana North', '  Running 10 min late  ');
  check('a caregiver message is saved', Boolean(id1));
  eq('  ...trimmed', (await queryOne('SELECT body FROM messages WHERE id = $1', [id1])).body, 'Running 10 min late');
  eq('an empty caregiver message saves nothing', await db.sendCaregiverMessage(ORG, 'm-cg1', 'Ana', '   '), null);
  const long = await db.sendCaregiverMessage(ORG, 'm-cg1', 'Ana', 'x'.repeat(5000));
  eq('a very long message is capped at 2000 characters', (await queryOne('SELECT length(body) AS n FROM messages WHERE id = $1', [long])).n, 2000);
  await query('DELETE FROM messages WHERE id = $1', [long]);
  const reply = await db.sendOfficeMessage(ORG, 'm-cg1', { senderName: 'Olive Office', senderUserId: 'u-1', text: 'Thanks Ana!' });
  const r = await queryOne('SELECT * FROM messages WHERE id = $1', [reply]);
  check('an office reply is saved as from the office, already read by the office', r.mine === false && r.read_by_office_at && r.sender_user_id === 'u-1');
  await throws('the office cannot message another agency’s caregiver', () => db.sendOfficeMessage(ORG, 'm-cg5', { senderName: 'X', text: 'hi' }), 'not found');
  await throws('a location admin cannot message another location’s caregiver', () => db.sendOfficeMessage(ORG, 'm-cg2', { senderName: 'X', text: 'hi', locationId: north }), 'not found');
  check('  ...but can message their own', Boolean(await db.sendOfficeMessage(ORG, 'm-cg1', { senderName: 'Loc', text: 'hi', locationId: north })));
  await throws('an empty office message is refused', () => db.sendOfficeMessage(ORG, 'm-cg1', { senderName: 'X', text: ' ' }), 'Type a message');

  console.log('\n== threads and unread counts ==');
  await db.sendCaregiverMessage(ORG, 'm-cg2', 'Ben South', 'Can I swap Friday?');
  await db.sendCaregiverMessage(ORG, 'm-cg2', 'Ben South', 'Or Saturday works');
  let threads = await db.getMessageThreads(ORG);
  eq('threads list only caregivers with messages, newest first', threads.map((t) => t.caregiverId), ['m-cg2', 'm-cg1']);
  eq('  ...Ben has 2 unread', threads[0].unread, 2);
  eq('  ...Ana has 1 unread (the office replies don’t count)', threads[1].unread, 1);
  eq('office unread total', await db.getOfficeUnreadMessageCount(ORG), 3);
  eq('a location admin sees only their location’s unread', await db.getOfficeUnreadMessageCount(ORG, north), 1);
  eq('  ...and threads', (await db.getMessageThreads(ORG, { locationId: south })).map((t) => t.caregiverId), ['m-cg2']);
  const all = await db.getMessageThreads(ORG, { includeEmpty: true });
  check('"new message" view lists every caregiver in the agency', all.length === 5 && !all.some((t) => t.caregiverId === 'm-cg5'));
  eq('opening a thread marks it read', await db.markThreadReadByOffice(ORG, 'm-cg2'), 2);
  eq('  ...unread now 1', await db.getOfficeUnreadMessageCount(ORG), 1);
  eq('a location admin can’t mark another location’s thread read', await db.markThreadReadByOffice(ORG, 'm-cg1', south), 0);
  eq('caregiver unread = office messages not yet seen', await db.getCaregiverUnreadMessageCount(ORG, 'm-cg1'), 2);
  await db.markThreadReadByCaregiver(ORG, 'm-cg1');
  eq('  ...0 after she opens Messages', await db.getCaregiverUnreadMessageCount(ORG, 'm-cg1'), 0);
  check('another agency sees none of it', (await db.getMessageThreads(OTHER)).length === 0 && (await db.getOfficeUnreadMessageCount(OTHER)) === 0);
  const thread = await db.getMessagesForCaregiver(ORG, 'm-cg1');
  check('messages carry a real timestamp for display', thread.every((m) => m.createdAt instanceof Date));

  console.log('\n== notifying the caregiver ==');
  let res = await notifyCaregiverOfOfficeMessage(ORG, 'm-cg1', 'Walter has a fever, check temp');
  eq('default channel: one text', res.map((x) => [x.channel, x.status]), [['sms', 'logged']]);
  let sms = (await notes('message_to_caregiver')).at(-1);
  eq('  ...to her number in E.164', sms.recipient, '+15125550101');
  check('  ...and it does NOT include the message (no PHI by text)', !sms.body.includes('fever') && sms.body.includes('sent you a message'));
  process.env.NOTIFY_INCLUDE_MESSAGE_TEXT = 'true';
  await notifyCaregiverOfOfficeMessage(ORG, 'm-cg1', 'Shift moved to 2pm');
  check('with NOTIFY_INCLUDE_MESSAGE_TEXT the text includes the message', (await notes('message_to_caregiver')).at(-1).body.includes('Shift moved to 2pm'));
  delete process.env.NOTIFY_INCLUDE_MESSAGE_TEXT;
  process.env.APP_BASE_URL = 'https://app.example.com';
  await notifyCaregiverOfOfficeMessage(ORG, 'm-cg1', 'x');
  check('with APP_BASE_URL the text links to Messages', (await notes('message_to_caregiver')).at(-1).body.includes('https://app.example.com/caregiver/messages'));
  delete process.env.APP_BASE_URL;
  res = await notifyCaregiverOfOfficeMessage(ORG, 'm-cg3', 'x');
  eq('no phone on file -> skipped, not an error', res, [{ channel: 'sms', status: 'skipped', error: 'No phone number on file.' }]);
  await db.updateOrganizationCommsSettings(ORG, { notifyEmail: '', caregiverNotifyChannel: 'both' });
  res = await notifyCaregiverOfOfficeMessage(ORG, 'm-cg1', 'x');
  eq('"both" -> text and email', res.map((x) => x.channel), ['sms', 'email']);
  res = await notifyCaregiverOfOfficeMessage(ORG, 'm-cg2', 'x');
  eq('"both" with no email on file -> text sent, email skipped', res.map((x) => x.status), ['logged', 'skipped']);
  await db.updateOrganizationCommsSettings(ORG, { notifyEmail: '', caregiverNotifyChannel: 'none' });
  eq('"none" -> nothing sent', await notifyCaregiverOfOfficeMessage(ORG, 'm-cg1', 'x'), []);
  eq('another agency’s caregiver -> nothing', await notifyCaregiverOfOfficeMessage(ORG, 'm-cg5', 'x'), []);

  console.log('\n== notifying the office ==');
  eq('no office email set -> nothing sent', await notifyOfficeOfCaregiverMessage(ORG, 'm-cg1', 'x'), null);
  await db.updateOrganizationCommsSettings(ORG, { notifyEmail: 'office@msg.test', caregiverNotifyChannel: 'sms' });
  const o = await notifyOfficeOfCaregiverMessage(ORG, 'm-cg1', 'Client fell, called 911');
  check('office email set -> emailed', o && o.status === 'logged');
  const officeNote = (await notes('message_to_office')).at(-1);
  check('  ...names the caregiver but not the message', officeNote.subject.includes('Ana North') && !officeNote.body.includes('911'));

  console.log('\n== inbound texts ==');
  let inb = await handleInboundSms({ from: '+15125550101', body: 'Stuck in traffic' });
  check('a text from a known caregiver is filed in her thread', inb.filed && inb.caregiverId === 'm-cg1' && inb.organizationId === ORG);
  eq('  ...reply confirms', inb.reply, MATCHED_REPLY);
  const filed = await queryOne(`SELECT * FROM messages WHERE caregiver_id = 'm-cg1' ORDER BY created_at DESC LIMIT 1`);
  check('  ...as source sms, unread by the office', filed.source === 'sms' && filed.mine === true && !filed.read_by_office_at && filed.body === 'Stuck in traffic');
  inb = await handleInboundSms({ from: '(512) 555-0102', body: 'hi' });
  check('number formatting differences still match', inb.filed && inb.caregiverId === 'm-cg2');
  inb = await handleInboundSms({ from: '+15125550000', body: 'who is this' });
  eq('an unknown number is not filed and gets the pointer reply', [inb.filed, inb.reply], [false, UNMATCHED_REPLY]);
  inb = await handleInboundSms({ from: '+15125550104', body: 'hello' });
  check('an inactive caregiver is not matched', !inb.filed);
  inb = await handleInboundSms({ from: '+15125550199', body: 'which agency?' });
  check('the same number at two agencies is NOT guessed', !inb.filed && inb.reply === UNMATCHED_REPLY);
  inb = await handleInboundSms({ from: '+15125550101', body: 'STOP' });
  check('carrier keywords (STOP) are left to Twilio', !inb.filed && inb.reply === null);
  eq('twiml escapes', twiml('a < b & c'), '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &lt; b &amp; c</Message></Response>');
  eq('twiml with no reply is empty', twiml(null), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  console.log('\n== display times (US Central) ==');
  const now = new Date('2026-09-24T20:00:00Z'); // 3:00 PM Central
  eq('today', formatMessageTime(new Date('2026-09-24T15:05:00Z'), now), '10:05 AM');
  eq('yesterday', formatMessageTime(new Date('2026-09-23T15:05:00Z'), now), 'Yesterday 10:05 AM');
  eq('this week', formatMessageTime(new Date('2026-09-21T15:05:00Z'), now), 'Mon 10:05 AM');
  eq('older', formatMessageTime(new Date('2026-09-01T15:05:00Z'), now), 'Sep 1');
  eq('late evening Central is still "today" though it is tomorrow in UTC', formatMessageTime(new Date('2026-09-25T03:30:00Z'), new Date('2026-09-25T04:00:00Z')), '10:30 PM');
  eq('bad input -> empty', formatMessageTime('nope'), '');
}

run().then(async () => {
  console.log = origLog;
  console.log('\n' + '='.repeat(60));
  console.log(`MESSAGES RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.log = origLog; console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
