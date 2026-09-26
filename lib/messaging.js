// Who gets told when a message is sent, and how. Server-side only; no
// next/* imports so QA can drive it. Notifications never block or undo the
// message itself — lib/comms never throws.
import * as db from '@/lib/queries';
import { sendEmail, sendSms } from '@/lib/comms';
import { appBaseUrl, includeMessageText } from '@/lib/comms/config';
import {
  newMessageForCaregiverSms,
  newMessageForCaregiverEmail,
  newMessageForOfficeEmail,
  previewOf,
} from '@/lib/comms/templates';

function link(path) {
  const base = appBaseUrl();
  return base ? `${base}${path}` : null;
}

// Office replied -> tell the caregiver, the agency's chosen way.
// Returns [{ channel, status, error }] for the UI to report.
export async function notifyCaregiverOfOfficeMessage(organizationId, caregiverId, text) {
  const [organization, caregiver] = await Promise.all([
    db.getOrganization(organizationId),
    db.getCaregiver(organizationId, caregiverId),
  ]);
  if (!organization || !caregiver) return [];
  const channel = organization.caregiverNotifyChannel || 'sms';
  if (channel === 'none') return [];
  const preview = includeMessageText() ? previewOf(text) : null;
  const url = link('/caregiver/messages');
  const results = [];

  if (channel === 'sms' || channel === 'both') {
    if (caregiver.phone) {
      const r = await sendSms({
        organizationId,
        to: caregiver.phone,
        template: 'message_to_caregiver',
        ...newMessageForCaregiverSms({ organizationName: organization.name, preview, url }),
      });
      results.push({ channel: 'sms', status: r.status, error: r.error || null });
    } else {
      results.push({ channel: 'sms', status: 'skipped', error: 'No phone number on file.' });
    }
  }
  if (channel === 'email' || channel === 'both') {
    if (caregiver.email) {
      const r = await sendEmail({
        organizationId,
        to: caregiver.email,
        template: 'message_to_caregiver',
        fromName: `${organization.name} via Athleone`,
        ...newMessageForCaregiverEmail({ name: caregiver.name, organizationName: organization.name, preview, url }),
      });
      results.push({ channel: 'email', status: r.status, error: r.error || null });
    } else {
      results.push({ channel: 'email', status: 'skipped', error: 'No email on file.' });
    }
  }
  return results;
}

// Caregiver wrote in -> email the agency's office inbox, if one is set.
export async function notifyOfficeOfCaregiverMessage(organizationId, caregiverId, text) {
  const organization = await db.getOrganization(organizationId);
  if (!organization?.notifyEmail) return null;
  const caregiver = await db.getCaregiver(organizationId, caregiverId);
  const preview = includeMessageText() ? previewOf(text) : null;
  return sendEmail({
    organizationId,
    to: organization.notifyEmail,
    template: 'message_to_office',
    ...newMessageForOfficeEmail({ caregiverName: caregiver?.name, preview, url: link(`/admin/messages?c=${encodeURIComponent(caregiverId)}`) }),
  });
}
