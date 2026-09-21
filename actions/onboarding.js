'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import { hashPassword } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import * as db from '@/lib/queries';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function yesNo(formData, field) {
  const v = formData.get(field);
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

// Submitted by the caregiver from her own onboarding checklist. The
// caregiver id comes from the session, never the form — nobody can submit
// an application against someone else's record.
export async function submitApplicationAction(prevState, formData) {
  const session = await requirePermission('caregiver.onboarding.apply');
  if (!session.caregiverId) return { error: 'No caregiver record linked to this account.' };

  if (!formData.get('certifiedTrue')) {
    return { error: 'Please confirm the information is accurate before submitting.' };
  }

  const employers = [1, 2]
    .map((i) => ({
      company: String(formData.get(`employer${i}Company`) || '').trim(),
      position: String(formData.get(`employer${i}Position`) || '').trim(),
      dates: String(formData.get(`employer${i}Dates`) || '').trim(),
      supervisor: String(formData.get(`employer${i}Supervisor`) || '').trim(),
      reasonForLeaving: String(formData.get(`employer${i}Reason`) || '').trim(),
    }))
    .filter((e) => e.company);

  const referencesList = [1, 2]
    .map((i) => ({
      name: String(formData.get(`reference${i}Name`) || '').trim(),
      phone: String(formData.get(`reference${i}Phone`) || '').trim(),
    }))
    .filter((r) => r.name);

  if (referencesList.length < 2) {
    return { error: 'Two non-family references are required.' };
  }

  try {
    await db.submitApplication(session.organizationId, session.caregiverId, {
      fullName: String(formData.get('fullName') || '').trim(),
      dateOfBirth: String(formData.get('dateOfBirth') || '').trim() || null,
      phone: String(formData.get('phone') || '').trim() || null,
      email: String(formData.get('email') || '').trim() || null,
      address: String(formData.get('address') || '').trim() || null,
      city: String(formData.get('city') || '').trim() || null,
      state: String(formData.get('state') || '').trim() || null,
      zip: String(formData.get('zip') || '').trim() || null,
      positionApplied: String(formData.get('positionApplied') || '').trim() || null,
      employmentType: String(formData.get('employmentType') || '').trim() || null,
      availableStart: String(formData.get('availableStart') || '').trim() || null,
      workAuthorized: yesNo(formData, 'workAuthorized'),
      workedHereBefore: yesNo(formData, 'workedHereBefore'),
      reliableTransport: yesNo(formData, 'reliableTransport'),
      driversLicense: yesNo(formData, 'driversLicense'),
      criminalDisclosure: yesNo(formData, 'criminalDisclosure'),
      criminalExplanation: String(formData.get('criminalExplanation') || '').trim() || null,
      hasPasExperience: yesNo(formData, 'hasPasExperience'),
      experienceYears: String(formData.get('experienceYears') || '').trim() || null,
      employers,
      referencesList,
      daysAvailable: DAYS.filter((d) => formData.get(`day_${d}`)),
      certifiedTrue: true,
    });
  } catch (err) {
    return { error: err.message || 'Could not submit the application.' };
  }

  revalidatePath('/caregiver/onboarding');
  revalidatePath(`/admin/caregivers/${session.caregiverId}`);
  redirect('/caregiver/onboarding?submitted=1');
}

// Admin adds a new applicant plus the login they will use to onboard.
export async function addCaregiverAction(prevState, formData) {
  const session = await requirePermission('admin.caregivers.manage');

  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!name || !email || !password) {
    return { error: 'Name, email and a starting password are all required.' };
  }
  if (password.length < 8) {
    return { error: 'Use a starting password of at least 8 characters.' };
  }

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return { error: 'An account with that email already exists.' };
  }

  // A location admin can only ever hire into their own location — the
  // form's value is ignored for them, not trusted. And a location is
  // required for everyone: the form marks the select required, but a
  // Server Action is a public endpoint, so that has to hold here too.
  const locationId = session.locationId || String(formData.get('locationId') || '').trim() || null;
  if (!locationId) {
    return { error: 'Pick the location this caregiver is being hired into.' };
  }

  let caregiverId;
  try {
    caregiverId = await db.createCaregiverWithLogin(session.organizationId, {
      name,
      email,
      role: String(formData.get('role') || 'Home Care Aide').trim(),
      phone: String(formData.get('phone') || '').trim(),
      passwordHash: await hashPassword(password),
      locationId,
    });
  } catch (err) {
    return { error: err.message || 'Could not create the caregiver.' };
  }

  revalidatePath('/admin/caregivers');
  redirect(`/admin/caregivers/${caregiverId}`);
}

// Activation is the office's decision and is gated on the things that
// legally gate a first shift: current registry/criminal checks and an I-9
// on file. The caregiver finishing her own paperwork is not sufficient.
export async function activateCaregiverAction(caregiverId) {
  const session = await requirePermission('admin.caregivers.manage');
  const state = await db.getOnboardingState(session.organizationId, caregiverId);
  if (!state.readyToActivate) return;

  await db.setCaregiverStatus(session.organizationId, caregiverId, 'active');
  revalidatePath(`/admin/caregivers/${caregiverId}`);
  revalidatePath('/admin/caregivers');
}
