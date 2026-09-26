'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { sendEmail, sendSms } from '@/lib/comms';
import { testEmail, testSms } from '@/lib/comms/templates';
import { toE164 } from '@/lib/comms/phone';

// /admin/communications — agency notification settings + test sends.
export async function saveCommsSettingsAction(prevState, formData) {
  const session = await requirePermission('admin.communications.manage');
  const before = await db.getOrganization(session.organizationId);
  const next = {
    notifyEmail: String(formData.get('notifyEmail') || ''),
    caregiverNotifyChannel: String(formData.get('caregiverNotifyChannel') || 'sms'),
  };
  try {
    await db.updateOrganizationCommsSettings(session.organizationId, next);
  } catch (err) {
    return { error: err.message || 'Could not save.', success: null };
  }
  const after = await db.getOrganization(session.organizationId);
  const changes = [];
  if ((before.notifyEmail || '') !== (after.notifyEmail || '')) changes.push(`office notification email ${after.notifyEmail ? 'set' : 'cleared'}`);
  if (before.caregiverNotifyChannel !== after.caregiverNotifyChannel) {
    changes.push(`caregiver notifications ${before.caregiverNotifyChannel} -> ${after.caregiverNotifyChannel}`);
  }
  if (!changes.length) return { error: null, success: 'No changes.' };
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_comms_settings',
    entityType: 'organization',
    entityId: session.organizationId,
    detail: changes.join('; '),
  });
  revalidatePath('/admin/communications');
  return { error: null, success: 'Saved.' };
}

function describe(result, channel) {
  if (result.status === 'logged') {
    return {
      tone: 'warn',
      text: `No ${channel} provider is connected, so nothing was delivered — the message was recorded in the outbox below. Add the provider's keys to the server's environment to send for real.`,
    };
  }
  if (result.ok) return { tone: 'good', text: `Sent. The provider accepted the ${channel}.` };
  return { tone: 'bad', text: result.error || `The ${channel} could not be sent.` };
}

export async function sendTestEmailAction(prevState, formData) {
  const session = await requirePermission('admin.communications.manage');
  const to = String(formData.get('to') || session.email || '').trim();
  const organization = await db.getOrganization(session.organizationId);
  const t = testEmail({ sentBy: session.name });
  const result = await sendEmail({
    organizationId: session.organizationId,
    userId: session.userId,
    to,
    template: 'test_email',
    fromName: organization?.name ? `${organization.name} via Athleone` : undefined,
    ...t,
  });
  revalidatePath('/admin/communications');
  return describe(result, 'email');
}

export async function sendTestSmsAction(prevState, formData) {
  const session = await requirePermission('admin.communications.manage');
  const to = String(formData.get('to') || '').trim();
  if (!toE164(to)) return { tone: 'bad', text: 'Enter a mobile number, e.g. (512) 555-0147.' };
  const result = await sendSms({
    organizationId: session.organizationId,
    userId: session.userId,
    to,
    template: 'test_sms',
    ...testSms({ sentBy: session.name }),
  });
  revalidatePath('/admin/communications');
  return describe(result, 'text');
}

// /platform/communications — Hearth staff checking the platform-wide
// provider setup. Recorded with no organization (it belongs to no agency).
export async function platformSendTestAction(prevState, formData) {
  const session = await requirePermission('platform.communications.test');
  const channel = String(formData.get('channel') || 'email');
  const to = String(formData.get('to') || '').trim();
  let result;
  if (channel === 'sms') {
    if (!toE164(to)) return { tone: 'bad', text: 'Enter a mobile number.' };
    result = await sendSms({ to, template: 'test_sms', ...testSms({ sentBy: `${session.name} (Athleone platform)` }) });
  } else {
    result = await sendEmail({ to: to || session.email, template: 'test_email', ...testEmail({ sentBy: `${session.name} (Athleone platform)` }) });
  }
  return describe(result, channel === 'sms' ? 'text' : 'email');
}
