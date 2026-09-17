'use server';

import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { verifyPassword, setSessionCookie, clearSessionCookie, getSession } from '@/lib/auth';

const ROLE_HOME = {
  ADMIN: '/admin',
  COORDINATOR: '/referrals',
  CAREGIVER: '/caregiver',
};

export async function loginAction(prevState, formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '');

  if (!email || !password) {
    return { error: 'Enter both an email and a password.' };
  }

  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) {
    return { error: 'No account found with that email.' };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return { error: 'Incorrect password.' };
  }

  await setSessionCookie({
    userId: user.id,
    organizationId: user.organization_id,
    email: user.email,
    name: user.name,
    role: user.role,
    caregiverId: user.caregiver_id,
  });

  redirect(next && next.startsWith('/') ? next : ROLE_HOME[user.role] || '/');
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/login');
}

export async function requireSession(allowedRoles) {
  const session = await getSession();
  if (!session || (allowedRoles && !allowedRoles.includes(session.role))) {
    redirect('/login');
  }
  return session;
}
