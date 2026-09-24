'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';

// EVV Export page bulk actions. Every visit id is re-checked (and location
// scoped) in lib/queries.js; the form's list is never trusted.
function actor(session) {
  return { userId: session.userId, name: session.name, role: session.role, locationId: session.locationId };
}
function ids(formData) {
  return formData.getAll('visitIds').map(String);
}
function refresh() {
  revalidatePath('/admin/evv/export');
  revalidatePath('/admin/evv/sync');
  revalidatePath('/admin/evv');
}

export async function holdVisitsAction(prevState, formData) {
  const session = await requirePermission('admin.evv.export.manage');
  try {
    const changed = await db.setVisitsExportHold(session.organizationId, ids(formData), true, formData.get('reason'), actor(session));
    refresh();
    return { error: null, success: changed.length ? `${changed.length} visit(s) put on hold.` : 'Those visits were already on hold.' };
  } catch (err) {
    return { error: err.message || 'Could not hold the visits.', success: null };
  }
}

export async function releaseVisitsAction(prevState, formData) {
  const session = await requirePermission('admin.evv.export.manage');
  try {
    const changed = await db.setVisitsExportHold(session.organizationId, ids(formData), false, null, actor(session));
    refresh();
    return { error: null, success: changed.length ? `${changed.length} visit(s) released.` : 'None of those visits were on hold.' };
  } catch (err) {
    return { error: err.message || 'Could not release the visits.', success: null };
  }
}

export async function queueVisitsAction(prevState, formData) {
  const session = await requirePermission('admin.evv.export.manage');
  try {
    const { queued, skipped } = await db.queueVisitsForExport(session.organizationId, ids(formData), actor(session));
    refresh();
    const parts = [];
    if (queued.length) parts.push(`${queued.length} visit(s) queued to send.`);
    if (skipped.length) parts.push(`${skipped.length} skipped (${[...new Set(skipped.map((s) => s.reason))].join('; ')}).`);
    return { error: null, success: parts.join(' ') || 'Nothing to queue.' };
  } catch (err) {
    return { error: err.message || 'Could not queue the visits.', success: null };
  }
}
