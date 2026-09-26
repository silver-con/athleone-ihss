// A caregiver texted the platform's Twilio number. Match the sender to
// exactly one caregiver (across all agencies) and file the text in their
// thread; otherwise reply with a short, PHI-free pointer to the app.
// No next/* imports so QA can drive it directly.
import * as db from '@/lib/queries';
import { toE164 } from '@/lib/comms/phone';
import { notifyOfficeOfCaregiverMessage } from '@/lib/messaging';

export const UNMATCHED_REPLY =
  "Athleone couldn't match this number to a caregiver account, so your message wasn't delivered. Please use the Athleone app or call your agency office.";
export const MATCHED_REPLY = 'Got it — your message was sent to the office in Athleone.';

// Carrier keywords Twilio handles itself (opt-out / opt-in / help).
const CARRIER_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'START', 'UNSTOP', 'YES', 'HELP', 'INFO']);

// Returns { reply, filed, caregiverId, organizationId }.
// messageSid: Twilio's id for the text. Twilio retries a webhook that was
// slow to answer; the same id is filed only once.
export async function handleInboundSms({ from, body, messageSid = null }) {
  const text = String(body || '').trim();
  if (messageSid && (await db.messageExistsByExternalId(messageSid))) return { reply: MATCHED_REPLY, filed: false, duplicate: true };
  if (CARRIER_KEYWORDS.has(text.toUpperCase())) return { reply: null, filed: false };
  const phone = toE164(from);
  const caregiver = phone ? await db.findCaregiverByPhoneAcrossOrganizations(phone) : null;
  if (!caregiver) return { reply: UNMATCHED_REPLY, filed: false };
  if (!text) return { reply: null, filed: false };
  const id = await db.sendCaregiverMessage(caregiver.organizationId, caregiver.id, caregiver.name, text, { source: 'sms', externalId: messageSid });
  if (id) await notifyOfficeOfCaregiverMessage(caregiver.organizationId, caregiver.id, text);
  return { reply: MATCHED_REPLY, filed: Boolean(id), caregiverId: caregiver.id, organizationId: caregiver.organizationId };
}

export function twiml(message) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ''}</Response>`;
}
