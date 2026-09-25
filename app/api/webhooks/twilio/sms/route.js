// Twilio "A message comes in" webhook for the platform's number. In the
// Twilio console: Phone Numbers -> your number -> Messaging -> "A message
// comes in" -> Webhook, HTTP POST, https://<APP_BASE_URL>/api/webhooks/twilio/sms
// Every request's X-Twilio-Signature is verified before anything is read.
import { smsConfig, appBaseUrl } from '@/lib/comms/config';
import { readTwilioWebhook } from '@/lib/comms/twilio-signature';
import { handleInboundSms, twiml } from '@/lib/inbound-sms';

export async function POST(request) {
  const cfg = smsConfig();
  const { ok, params, reason } = await readTwilioWebhook(request, {
    authToken: cfg.twilio.authToken,
    baseUrl: appBaseUrl(),
  });
  if (!ok) {
    console.warn(`[twilio] inbound sms rejected: ${reason}`);
    return new Response('Forbidden', { status: 403 });
  }
  const result = await handleInboundSms({ from: params.From, body: params.Body });
  console.log(`[twilio] inbound sms ${result.filed ? 'filed' : 'not filed'}`);
  return new Response(twiml(result.reply), { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
