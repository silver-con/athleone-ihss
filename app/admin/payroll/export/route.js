// Payroll hours as CSV for the agency's payroll company. Same permission
// and location scope as the page; every download is audit-logged because
// the file names clients. Never cached.
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getPayrollVisits, logAuditEvent } from '@/lib/queries';
import { resolvePayPeriod, buildPayrollReport, payrollCsv, fmtHours } from '@/lib/payroll-hours';
import { addDays, mondayOf } from '@/lib/calendar';

export async function GET(request) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, 'admin.payroll.view')) return new Response('Not found', { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const period = resolvePayPeriod(params);
  const { rows, auths } = await getPayrollVisits(
    session.organizationId,
    { from: mondayOf(period.from), to: addDays(mondayOf(period.to), 6) },
    session.locationId
  );
  const report = buildPayrollReport({ rows, auths, period });
  await logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name || 'Unknown',
    actorRole: session.role,
    locationId: session.locationId,
    action: 'payroll_hours_exported',
    entityType: 'payroll',
    entityId: null,
    detail: `${period.from} to ${period.to}: ${report.summary.attendants} attendant(s), ${report.summary.verifiedVisits} verified visit(s), ${fmtHours(report.summary.verifiedMinutes)} verified hrs${report.summary.needsAttention ? `; ${report.summary.needsAttention} visit(s) still needed attention` : ''}`,
  });
  return new Response(payrollCsv(report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll-hours-${period.from}-to-${period.to}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
