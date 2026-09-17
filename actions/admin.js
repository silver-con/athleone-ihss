'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/actions/auth';
import * as db from '@/lib/queries';

export async function toggleCaregiverStatusAction(caregiverId) {
  const session = await requireSession(['ADMIN']);
  await db.toggleCaregiverStatus(session.organizationId, caregiverId);
  revalidatePath('/admin/caregivers');
  revalidatePath('/admin/schedule');
  revalidatePath('/admin');
}

export async function assignCaregiverAction(clientId, caregiverId) {
  const session = await requireSession(['ADMIN']);
  await db.assignCaregiver(session.organizationId, clientId, caregiverId);
  revalidatePath('/admin/clients');
  revalidatePath('/admin');
}

export async function resolveVisitExceptionAction(visitId) {
  const session = await requireSession(['ADMIN']);
  await db.resolveVisitException(session.organizationId, visitId);
  revalidatePath('/admin/evv');
  revalidatePath('/admin/compliance');
  revalidatePath('/admin');
}

export async function submitVMURAction(visitId) {
  const session = await requireSession(['ADMIN']);
  await db.submitVMUR(session.organizationId, visitId);
  revalidatePath('/admin/compliance');
  revalidatePath('/admin');
}
