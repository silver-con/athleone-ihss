import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAuditLog } from '@/lib/queries';
import StatTile from '@/components/StatTile';

// ADMIN-only (see lib/permissions.js's admin.auditLog.view) — shows every
// location's activity, matching the same "cross-location detail is
// ADMIN-only" pattern as /admin/evv/sync and /admin/locations. A
// LOCATION_ADMIN's own actions still get written to audit_log by
// lib/queries.js's logAuditEvent, they just aren't readable from here.
//
// Scope is deliberately narrow: only the three areas named in
// enterprise-readiness-roadmap.md's audit-trail item are logged today —
// service authorizations (a client's care plan), billing line changes,
// and this tenant's own EVV credentials. Extending coverage to other
// mutations (caregiver status overrides, visit-exception resolution,
// team management, ...) is a future pass, not done here.

const ACTION_LABEL = {
  create_service_authorization: 'Created a service authorization',
  create_billing_line: 'Added a billing line',
  update_billing_line_status: 'Changed a billing line status',
  create_evv_credentials: 'Set up EVV credentials',
  update_evv_credentials: 'Updated EVV credentials',
};

const ENTITY_LABEL = {
  service_authorization: 'Care plan',
  billing_line: 'Billing',
  evv_credentials: 'EVV',
};

const ENTITY_STYLE = {
  service_authorization: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  billing_line: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]',
  evv_credentials: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]',
};

export default async function AuditLogPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const log = await getAuditLog(session.organizationId);
  const count = (entityType) => log.filter((r) => r.entityType === entityType).length;

  return (
    <div>
      <div>
        <h1 className="font-display font-extrabold text-[24px]">Audit Log</h1>
        <p className="text-[13.5px] text-[var(--muted)] mt-1">
          Who changed what — care plans, billing lines, and EVV credentials — across this agency,
          newest first.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mt-6">
        <StatTile num={log.length} label="Total events" />
        <StatTile num={count('service_authorization')} label="Care plan changes" />
        <StatTile num={count('billing_line')} label="Billing changes" />
        <StatTile num={count('evv_credentials')} label="EVV credential changes" />
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
        <div className="grid grid-cols-[1.3fr_1.6fr_0.9fr_1fr_2fr] px-5 py-3 text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]">
          <div>When</div>
          <div>Who</div>
          <div>Area</div>
          <div>Location</div>
          <div>What happened</div>
        </div>

        {log.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
            Nothing logged yet. An entry appears here the first time someone creates a service
            authorization, changes a billing line, or saves EVV credentials.
          </div>
        )}

        {log.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1.3fr_1.6fr_0.9fr_1fr_2fr] px-5 py-3.5 text-[13px] items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
          >
            <div className="text-[12px] text-[var(--muted)]">
              {new Date(row.createdAt).toLocaleString('en-US')}
            </div>
            <div>
              <div className="font-display font-bold text-[13px]">{row.actorName}</div>
              <div className="text-[11px] text-[var(--muted)]">{row.actorRole}</div>
            </div>
            <div>
              <span
                className={
                  'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ' +
                  (ENTITY_STYLE[row.entityType] || 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]')
                }
              >
                {ENTITY_LABEL[row.entityType] || row.entityType}
              </span>
            </div>
            <div className="text-[12px] text-[var(--muted)]">{row.locationName || 'Agency-wide'}</div>
            <div className="text-[12.5px] min-w-0">
              <div className="font-display font-bold">{ACTION_LABEL[row.action] || row.action}</div>
              {row.detail && (
                <div className="text-[12px] text-[var(--muted)] break-words">{row.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
