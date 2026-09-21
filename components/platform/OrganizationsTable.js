'use client';

// Interactive controls layer for the platform overview table — search by
// name, filter by account status and EVV status. Pure client-side over
// the already-fetched (and already small — one row per agency) dataset
// from app/platform/page.js, same pattern as ScheduleClient.js: the
// server component fetches, this component makes it explorable.
import { useMemo, useState } from 'react';
import Link from 'next/link';

const EVV_STATUS_LABEL = {
  not_started: 'Not started',
  testing: 'Testing',
  passed: 'Sandbox passed',
  live: 'Live',
  disabled: 'Disabled',
};

const EVV_STATUS_TONE = {
  not_started: 'neutral',
  testing: 'amber',
  passed: 'amber',
  live: 'success',
  disabled: 'danger',
};

const ORG_STATUS_TONE = {
  trial: 'amber',
  active: 'success',
  suspended: 'danger',
};

const TONE_CLASSES = {
  neutral: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
  amber: 'bg-[var(--amber-soft)] text-[var(--amber)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
};

function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-display font-bold whitespace-nowrap ' +
        (TONE_CLASSES[tone] || TONE_CLASSES.neutral)
      }
    >
      {children}
    </span>
  );
}

function currency(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const STATUS_OPTIONS = ['all', 'trial', 'active', 'suspended'];
const EVV_OPTIONS = ['all', 'not_configured', 'not_started', 'testing', 'passed', 'live', 'disabled'];
const EVV_FILTER_LABEL = {
  all: 'Any EVV status',
  not_configured: 'Not configured',
  not_started: 'Not started',
  testing: 'Testing',
  passed: 'Sandbox passed',
  live: 'Live',
  disabled: 'Disabled',
};
const SORT_OPTIONS = [
  { key: 'created_desc', label: 'Newest first' },
  { key: 'created_asc', label: 'Oldest first' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'exceptions_desc', label: 'Most open exceptions' },
  { key: 'pending_desc', label: 'Most pending revenue' },
];

export default function OrganizationsTable({ organizations }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [evvFilter, setEvvFilter] = useState('all');
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [sort, setSort] = useState('created_desc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = organizations.filter((org) => {
      if (q && !org.name.toLowerCase().includes(q) && !(org.state || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && org.status !== statusFilter) return false;
      if (evvFilter !== 'all') {
        const effective = org.evvStatus || 'not_configured';
        if (effective !== evvFilter) return false;
      }
      if (needsAttentionOnly) {
        const needsAttention =
          org.status === 'suspended' ||
          org.evvFailedCount > 0 ||
          org.openExceptionCount > 0 ||
          !org.providerInfoDone;
        if (!needsAttention) return false;
      }
      return true;
    });

    rows = rows.slice().sort((a, b) => {
      switch (sort) {
        case 'created_asc':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'exceptions_desc':
          return b.openExceptionCount - a.openExceptionCount;
        case 'pending_desc':
          return b.billingPendingAmount - a.billingPendingAmount;
        case 'created_desc':
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });
    return rows;
  }, [organizations, search, statusFilter, evvFilter, needsAttentionOnly, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 mt-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agency or state…"
          className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] min-w-[220px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'Any account status' : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select
          value={evvFilter}
          onChange={(e) => setEvvFilter(e.target.value)}
          className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {EVV_OPTIONS.map((s) => (
            <option key={s} value={s}>{EVV_FILTER_LABEL[s]}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] cursor-pointer select-none ml-1">
          <input
            type="checkbox"
            checked={needsAttentionOnly}
            onChange={(e) => setNeedsAttentionOnly(e.target.checked)}
          />
          Needs attention only
        </label>
        <span className="text-[12px] text-[var(--muted)] ml-auto whitespace-nowrap">
          {filtered.length} of {organizations.length}
        </span>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl mt-3 overflow-hidden overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left border-b border-[var(--border)] bg-[oklch(97%_0.006_85)]">
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Agency</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Account</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Go-live checklist</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">EVV status</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Open exceptions</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Locations</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Caregivers</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Pending revenue</th>
              <th className="px-4 py-3 font-display font-bold text-[11.5px] uppercase tracking-wide text-[var(--muted)]">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[var(--muted)]">
                  {organizations.length === 0 ? 'No agencies yet.' : 'No agencies match these filters.'}
                </td>
              </tr>
            )}
            {filtered.map((org) => (
              <tr key={org.id} className="border-b border-[var(--border)] last:border-b-0 align-top hover:bg-[oklch(98%_0.004_85)]">
                <td className="px-4 py-3.5">
                  <Link href={`/platform/organizations/${org.id}`} className="font-display font-bold text-[13.5px] text-[var(--accent)] hover:underline">
                    {org.name}
                  </Link>
                  <div className="text-[11.5px] text-[var(--muted)] mt-0.5">
                    {org.state || '—'}
                    {!org.providerInfoDone && ' · Provider info incomplete'}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={ORG_STATUS_TONE[org.status] || 'neutral'}>{org.status}</Badge>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-[oklch(94%_0.006_85)] overflow-hidden shrink-0">
                      <div
                        className={
                          'h-full rounded-full ' +
                          (org.onboardingStepsDone === org.onboardingStepsTotal ? 'bg-[var(--success)]' : 'bg-[var(--accent-strong)]')
                        }
                        style={{ width: `${(org.onboardingStepsDone / org.onboardingStepsTotal) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11.5px] text-[var(--muted)] whitespace-nowrap">
                      {org.onboardingStepsDone} of {org.onboardingStepsTotal}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={EVV_STATUS_TONE[org.evvStatus] || 'neutral'}>
                    {EVV_STATUS_LABEL[org.evvStatus] || 'Not configured'}
                  </Badge>
                  {org.evvFailedCount > 0 && (
                    <div className="text-[11px] text-[var(--danger)] font-display font-bold mt-1">
                      {org.evvFailedCount} failed sync{org.evvFailedCount === 1 ? '' : 's'}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {org.openExceptionCount > 0 ? (
                    <span className="font-display font-bold text-[var(--danger)]">{org.openExceptionCount}</span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5">{org.locationCount}</td>
                <td className="px-4 py-3.5">
                  {org.caregiverActiveCount} active
                  {org.caregiverPipelineCount > 0 && (
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">{org.caregiverPipelineCount} in pipeline</div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {org.billingPendingAmount > 0 ? currency(org.billingPendingAmount) : <span className="text-[var(--muted)]">—</span>}
                  {org.billingUnratedCount > 0 && (
                    <div className="text-[11px] text-[var(--amber)] font-display font-bold mt-0.5">
                      {org.billingUnratedCount} unrated
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5 text-[var(--muted)] whitespace-nowrap">
                  {new Date(org.createdAt).toLocaleDateString('en-US')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
