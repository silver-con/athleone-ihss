'use server';

import { redirect } from 'next/navigation';
import { getSession, hashPassword, setSessionCookie } from '@/lib/auth';
import { changeOwnPassword, logAuditEvent } from '@/lib/queries';
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
