// Payroll files as CSV for the agency's payroll company. Same permission
// and location scope as the page; every download is audit-logged because
// the files name clients. Never cached.
//   type=detail (default): one row per verified visit + a total per attendant.
//   type=summary: one row per attendant with gross pay (admin only).
// Once the pay period is approved, admins get the APPROVED copy (the locked
// numbers), not the live ones.
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/queries';
import { resolvePayPeriod, payrollCsv, fmtHours } from '@/lib/payroll-hours';
import { payrollSummaryCsv } from '@/lib/payroll-pay';
import { loadPayrollReport } from '@/lib/payroll-report';

export async function GET(request) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, 'admin.payroll.view')) return new Response('Not found', { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const canPay = hasPermission(session.role, 'admin.payroll.manage');
  const type = params.type === 'summary' ? 'summary' : 'detail';
  if (type === 'summary' && !canPay) return new Response('Not found', { status: 404 });

  const period = resolvePayPeriod(params);
  const { report: live, approved } = await loadPayrollReport(session.organizationId, period, { locationId: session.locationId });
  const fromApproved = Boolean(approved && canPay && !session.locationId);
  const report = fromApproved ? { period: approved.snapshot.period, attendants: approved.snapshot.attendants, summary: approved.snapshot.summary } : live;

  const csv = type === 'summary' ? payrollSummaryCsv(report) : payrollCsv(report, { includePay: canPay });
  const s = report.summary;
  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name || 'Unknown',
    actorRole: session.role,
    locationId: session.locationId,
    action: 'payroll_hours_exported',
    entityType: 'payroll',
    entityId: approved?.id || null,
    detail: `${type === 'summary' ? 'Pay summary' : 'Visit detail'}${canPay ? ' with pay' : ''}, ${period.from} to ${period.to}${fromApproved ? ' (approved copy)' : ''}: ${s.attendants} attendant(s), ${s.verifiedVisits} verified visit(s), ${fmtHours(s.verifiedMinutes)} hrs`,
  });
  const name = `payroll-${type}-${period.from}-to-${period.to}${fromApproved ? '-approved' : ''}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
