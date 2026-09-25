'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSession, hashPassword, setSessionCookie } from '@/lib/auth';
import { requirePermission } from '@/actions/auth';
import { changeOwnPassword, logAuditEvent, getTwoFactorSettings, updateTwoFactorSettings, verifyOwnPassword } from '@/lib/queries';
import { toE164 } from '@/lib/comms/phone';
import { passwordProblem } from '@/lib/passwords';
import { PERMISSIONS, ROLE_HOME } from '@/lib/permissions';

// Changing your own password. Usable while must_change_password is set —
// it's the way out of that state — so this checks the session and the
// permission catalog directly instead of going through requirePermission,
// which would bounce a must-change account straight back here.
export async function changePasswordAction(prevState, formData) {
  const session = await getSession();
  if (!session || !PERMISSIONS['shared.account.password.change'].roles.includes(session.role)) {
    redirect('/login');
  }

  const current = String(formData.get('currentPassword') || '');
  const next = String(formData.get('newPassword') || '');
  const confirm = String(formData.get('confirmPassword') || '');

  if (!current || !next) return { error: 'Enter your current password and a new one.' };
  if (next !== confirm) return { error: "The new passwords don't match." };
  const problem = passwordProblem(next, { email: session.email, name: session.name });
  if (problem) return { error: problem };

  let sessionVersion;
  try {
    sessionVersion = await changeOwnPassword(
      session.organizationId,
      session.userId,
      current,
      await hashPassword(next),
      next
    );
  } catch (err) {
    return { error: err.message || 'Could not change your password.' };
  }

  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'password_changed',
    entityType: 'user',
    entityId: session.userId,
    detail: session.mustChangePassword ? 'replaced a starting/reset password' : 'changed own password',
  });

  // Every other session for this account was just signed out (the version
  // moved on); keep THIS one signed in with a fresh token.
  await setSessionCookie({
    userId: session.userId,
    organizationId: session.organizationId,
    email: session.email,
    name: session.name,
    role: session.role,
    caregiverId: session.caregiverId || null,
    locationId: session.locationId || null,
    sv: sessionVersion,
    mustChangePassword: false,
  });
  redirect(ROLE_HOME[session.role] || '/');
}

// /account/security — the signed-in person's own two-step sign-in setting.
// Needs their current password: otherwise anyone who found an unlocked,
// signed-in screen could quietly switch the codes to their own phone.
export async function saveTwoFactorAction(prevState, formData) {
  const session = await requirePermission('shared.account.security.manage');
  const method = String(formData.get('method') || 'off');
  const rawPhone = String(formData.get('mobilePhone') || '').trim();
  const password = String(formData.get('currentPassword') || '');

  const current = await getTwoFactorSettings(session.organizationId, session.userId);
  if (!current) redirect('/login');
  if (!['off', 'email', 'sms'].includes(method)) return { error: 'Pick how you want to get sign-in codes.' };
  const officeRole = ['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR'].includes(session.role);
  if (method === 'off' && current.organizationRequiresTwoFactor && officeRole) {
    return { error: 'Your agency requires two-step sign-in for office accounts, so it can’t be turned off.' };
  }
  let mobilePhone = null;
  if (rawPhone) {
    mobilePhone = toE164(rawPhone);
    if (!mobilePhone) return { error: 'Enter a mobile number like (512) 555-0147.' };
  }
  if (method === 'sms' && !mobilePhone && !toE164(current.caregiverPhone)) {
    return { error: 'Enter the mobile number the codes should go to.' };
  }
  if (!(await verifyOwnPassword(session.organizationId, session.userId, password))) {
    return { error: 'Your current password is incorrect.' };
  }

  await updateTwoFactorSettings(session.organizationId, session.userId, { method, mobilePhone });
  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'two_factor_changed',
    entityType: 'user',
    entityId: session.userId,
    detail: `two-step sign-in: ${current.method} -> ${method}`,
  });
  revalidatePath('/account/security');
  return { success: method === 'off' ? 'Two-step sign-in is off.' : `Saved. Next time you sign in we’ll ${method === 'sms' ? 'text' : 'email'} you a code.` };
}
