'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { parseRate, buildSnapshot } from '@/lib/payroll-pay';
import { resolvePayPeriod } from '@/lib/payroll-hours';
import { loadPayrollReport } from '@/lib/payroll-report';

// Payroll: pay rates, approving (locking) a pay period and reopening it.
// ADMIN only (admin.payroll.manage). Every number is recomputed here from
// the database — nothing about hours or pay is taken from the form.
function actor(session) {
  return { userId: session.userId, name: session.name, role: session.role, locationId: session.locationId };
}
function refresh() {
  revalidatePath('/admin/payroll');
  revalidatePath('/admin/payroll/rates');
}

export async function savePayRateAction(prevState, formData) {
  const session = await requirePermission('admin.payroll.manage');
  try {
    const caregiverId = String(formData.get('caregiverId') || '');
    const clientId = String(formData.get('clientId') || '') || null;
    const rateCents = parseRate(formData.get('rate'));
    await db.setPayRate(session.organizationId, { caregiverId, clientId, rateCents }, actor(session));
    refresh();
    return { error: null, success: `Saved $${(rateCents / 100).toFixed(2)}/hr.` };
  } catch (err) {
    return { error: err.message || 'Could not save the rate.', success: null };
  }
}

export async function deletePayRateAction(prevState, formData) {
  const session = await requirePermission('admin.payroll.manage');
  try {
    await db.deletePayRate(session.organizationId, String(formData.get('rateId') || ''), actor(session));
    refresh();
    return { error: null, success: 'Rate removed.' };
  } catch (err) {
    return { error: err.message || 'Could not remove the rate.', success: null };
  }
}

export async function approvePayrollPeriodAction(prevState, formData) {
  const session = await requirePermission('admin.payroll.manage');
  try {
    const period = resolvePayPeriod({ freq: formData.get('freq'), period: formData.get('period') });
    if (period.from !== formData.get('period')) throw new Error('That isn’t the start of a pay period — reload the page and try again.');
    const { report, approved, overlapping, blockers } = await loadPayrollReport(session.organizationId, period);
    if (approved) throw new Error('This pay period is already approved.');
    if (overlapping.length) throw new Error(`Pay period ${overlapping[0].from} to ${overlapping[0].to} is already approved and overlaps these dates.`);
    if (blockers.length) throw new Error(blockers.join(' '));
    // What the admin saw must still be what gets approved.
    const seen = String(formData.get('grossCents') || '');
    if (seen !== String(report.summary.pay.grossCents)) throw new Error('Hours or rates changed while this page was open. Review the new totals and approve again.');
    await db.approvePayrollPeriod(session.organizationId, { period, snapshot: buildSnapshot(report) }, actor(session));
    refresh();
    return { error: null, success: 'Pay period approved and locked. Download the payroll files below.' };
  } catch (err) {
    return { error: err.message || 'Could not approve the pay period.', success: null };
  }
}

export async function reopenPayrollPeriodAction(prevState, formData) {
  const session = await requirePermission('admin.payroll.manage');
  try {
    await db.reopenPayrollPeriod(session.organizationId, String(formData.get('periodId') || ''), formData.get('reason'), actor(session));
    refresh();
    return { error: null, success: 'Pay period reopened. Approve it again once it’s corrected.' };
  } catch (err) {
    return { error: err.message || 'Could not reopen the pay period.', success: null };
  }
}
