// Small style lookup tables shared by the referral list, detail and clients
// views so payer/status colors stay consistent across the prototype.

export const PAYER_STYLES = {
  'Molina Healthcare': 'bg-[oklch(92%_0.05_250)] text-[oklch(42%_0.1_250)]',
  'Anthem Blue Cross': 'bg-[oklch(92%_0.05_230)] text-[oklch(40%_0.09_230)]',
  "St. Mary's Hospital": 'bg-[oklch(93%_0.04_55)] text-[oklch(42%_0.09_55)]',
};

export const STATUS_STYLES = {
  new: { label: 'New', className: 'bg-[oklch(94%_0.06_55)] text-[oklch(42%_0.11_55)]' },
  'in-progress': { label: 'In progress', className: 'bg-[var(--accent-soft)] text-[var(--accent)]' },
  completed: { label: 'Completed', className: 'bg-[var(--success-soft)] text-[var(--success)]' },
};

export function payerClass(payer) {
  return PAYER_STYLES[payer] || 'bg-[var(--border)] text-[var(--muted)]';
}

export function statusInfo(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.new;
}

// Covers the hiring pipeline as well as working state. Applicant and
// onboarding are pre-hire stages — a caregiver in either one should not
// be schedulable, which is why they read as distinct from Active rather
// than as a variant of it.
export const CAREGIVER_STATUS_STYLES = {
  applicant: { label: 'Applicant', className: 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]' },
  onboarding: { label: 'Onboarding', className: 'bg-[var(--accent-soft)] text-[var(--accent)]' },
  active: { label: 'Active', className: 'bg-[var(--success-soft)] text-[var(--success)]' },
  'on-leave': { label: 'On leave', className: 'bg-[oklch(94%_0.06_55)] text-[oklch(42%_0.11_55)]' },
  inactive: { label: 'Inactive', className: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]' },
};

export function caregiverStatusInfo(status) {
  return CAREGIVER_STATUS_STYLES[status] || CAREGIVER_STATUS_STYLES.active;
}

// Fixed role order for the three referral-status chart segments — a
// data-viz "categorical" set small enough (n=3) to read by hue + label.
export const REFERRAL_STATUS_ORDER = ['new', 'in-progress', 'completed'];

// Visit/shift status for the scheduling & EVV views. "Missed" gets the
// danger hue (distinct from the amber used for "new"/"on-leave") since it's
// the one status that represents a compliance problem, not just a normal
// stage in a workflow.
export const VISIT_STATUS_STYLES = {
  scheduled: { label: 'Scheduled', className: 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]', dot: 'oklch(68%_0.012_85)' },
  'in-progress': { label: 'In progress', className: 'bg-[var(--accent-soft)] text-[var(--accent)]', dot: 'var(--accent-strong)' },
  completed: { label: 'Completed', className: 'bg-[var(--success-soft)] text-[var(--success)]', dot: 'var(--success)' },
  missed: { label: 'Missed', className: 'bg-[var(--danger-soft)] text-[var(--danger)]', dot: 'var(--danger)' },
};

export function visitStatusInfo(status) {
  return VISIT_STATUS_STYLES[status] || VISIT_STATUS_STYLES.scheduled;
}

export const VISIT_STATUS_ORDER = ['completed', 'in-progress', 'missed', 'scheduled'];

// Days-remaining-until-lock color bands for a state's EVV visit
// maintenance window (see visitMaintenanceWindowDays in
// lib/state-compliance.js — 95 days for Texas). Only the fixed 7/30-day
// UI thresholds below are hardcoded; the actual day count is computed
// by the caller from the tenant's own state profile.
export function maintenanceUrgency(daysRemaining) {
  if (daysRemaining < 0) {
    return { label: 'VMUR required', className: 'bg-[var(--danger-soft)] text-[var(--danger)]' };
  }
  if (daysRemaining <= 7) {
    return { label: `${daysRemaining}d left`, className: 'bg-[var(--danger-soft)] text-[var(--danger)]' };
  }
  if (daysRemaining <= 30) {
    return { label: `${daysRemaining}d left`, className: 'bg-[var(--amber-soft)] text-[oklch(42%_0.11_55)]' };
  }
  return { label: `${daysRemaining}d left`, className: 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]' };
}

