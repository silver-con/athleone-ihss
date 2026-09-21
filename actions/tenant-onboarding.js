'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// Tenant onboarding go-live checklist (/admin/onboarding) — architecture
// spec §5/§7 Phase 3, scoped down to just the wizard/checklist (no
// platform/vendor-ops role, no incumbent-vendor migration tooling yet;
// those stay in the backlog). Every write here is self-service by the
// agency's own admin — there is no platform-ops role in this build to do
// it on their behalf, so the two attestation checkboxes record what the
// agency admin says is true, not something Hearth's software verifies.
//
// Named separately from actions/onboarding.js, which is the existing
// per-caregiver hiring/onboarding flow (application, add caregiver,
// activate) — different subject, kept in its own file to avoid colliding
// with that one's exports.

export async function updateProviderInfoAction(formData) {
  const session = await requirePermission('admin.onboarding.manage');
  await db.updateOrganizationOnboarding(session.organizationId, {
    state: String(formData.get('state') || '').trim().toUpperCase() || null,
    medicaidProviderNumber: String(formData.get('medicaidProviderNumber') || '').trim() || null,
    npi: String(formData.get('npi') || '').trim() || null,
    stateLicenseNumber: String(formData.get('stateLicenseNumber') || '').trim() || null,
  });
  revalidatePath('/admin/onboarding');
}

export async function updateProviderEnrollmentAction(formData) {
  const session = await requirePermission('admin.onboarding.manage');
  await db.updateOrganizationOnboarding(session.organizationId, {
    providerEnrollmentAttested: formData.has('providerEnrollmentAttested'),
  });
  revalidatePath('/admin/onboarding');
}

export async function updateBaaSignedAction(formData) {
  const session = await requirePermission('admin.onboarding.manage');
  await db.updateOrganizationOnboarding(session.organizationId, {
    baaSigned: formData.has('baaSigned'),
  });
  revalidatePath('/admin/onboarding');
}
