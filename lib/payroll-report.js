// Builds the live payroll report for a pay period from the database — the
// one place the page, the CSV route and the approve action all get it from,
// so what staff see is exactly what gets approved.
import { getPayrollVisits, getPayRates, getApprovedPayrollPeriod, getOverlappingApprovedPeriods } from '@/lib/queries';
import { buildPayrollReport } from '@/lib/payroll-hours';
import { addPay, changesSinceApproval, approvalBlockers } from '@/lib/payroll-pay';
import { addDays, mondayOf, todayIso } from '@/lib/calendar';

export async function loadPayrollReport(organizationId, period, { locationId = null, today = todayIso() } = {}) {
  const span = { from: mondayOf(period.from), to: addDays(mondayOf(period.to), 6) };
  const [{ rows, auths }, rates, approved, overlapping] = await Promise.all([
    getPayrollVisits(organizationId, span, locationId),
    getPayRates(organizationId),
    getApprovedPayrollPeriod(organizationId, period),
    getOverlappingApprovedPeriods(organizationId, period),
  ]);
  const report = addPay(buildPayrollReport({ rows, auths, period, today }), { rows, rates, today });
  // Approval is agency-wide, so only an unscoped (ADMIN) report can be
  // compared with the snapshot or approved.
  const unscoped = !locationId;
  return {
    report,
    rates,
    approved,
    overlapping: overlapping.filter((p) => !approved || p.id !== approved.id),
    changes: approved && unscoped ? changesSinceApproval(approved.snapshot, report) : [],
    blockers: unscoped ? approvalBlockers(report, today) : ['Only an agency admin can approve payroll.'],
  };
}
