// Twilio delivery receipts: Twilio POSTs here as a text moves from sent to
// delivered / undelivered / failed (lib/comms/index.js asks for this via
// StatusCallback when APP_BASE_URL is https). Updates the outbox row.
import { smsConfig, appBaseUrl } from '@/lib/comms/config';
import { readTwilioWebhook } from '@/lib/comms/twilio-signature';
import { applyDeliveryReceipt } from '@/lib/queries';

const STATUS_MAP = { sent: 'sent', delivered: 'delivered', undelivered: 'undelivered', failed: 'failed' };

export async function POST(request) {
  const cfg = smsConfig();
  const { ok, params, reason } = await readTwilioWebhook(request, {
    authToken: cfg.twilio.authToken,
    baseUrl: appBaseUrl(),
  });
  if (!ok) {
    console.warn(`[twilio] status callback rejected: ${reason}`);
    return new Response('Forbidden', { status: 403 });
  }
  const status = STATUS_MAP[params.MessageStatus];
  if (status) {
    const error = params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null;
    await applyDeliveryReceipt(params.MessageSid, status, error);
  }
  return new Response(null, { status: 204 });
}
