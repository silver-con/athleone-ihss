-- Payroll pay (2026-09-28): hourly pay rates per attendant, and approved
-- (locked) pay periods.
--
-- caregiver_pay_rates: one DEFAULT rate per attendant (client_id NULL) and
--   optional per-client rates. Entered by the agency; Athleone never
--   guesses a rate.
-- payroll_periods: one row per approval. `snapshot` freezes every visit's
--   hours, rate and pay at approval time, so later edits to a visit are
--   flagged instead of silently changing a paid period. Reopening keeps the
--   row (status 'reopened') for the audit trail; at most one APPROVED row
--   per agency and date range.
CREATE TABLE IF NOT EXISTS caregiver_pay_rates (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caregiver_id    text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  client_id       text REFERENCES clients(id) ON DELETE CASCADE,
  hourly_rate     numeric(8,2) NOT NULL CHECK (hourly_rate > 0 AND hourly_rate <= 500),
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_rates_unique ON caregiver_pay_rates(organization_id, caregiver_id, COALESCE(client_id, ''));

CREATE TABLE IF NOT EXISTS payroll_periods (
  id                  text PRIMARY KEY,
  organization_id     text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_from         text NOT NULL CHECK (period_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  period_to           text NOT NULL CHECK (period_to ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  frequency           text NOT NULL CHECK (frequency IN ('semimonthly', 'weekly')),
  status              text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'reopened')),
  snapshot            jsonb NOT NULL,
  approved_by_user_id text,
  approved_by_name    text NOT NULL,
  approved_at         timestamptz NOT NULL DEFAULT now(),
  reopened_by_name    text,
  reopened_at         timestamptz,
  reopen_reason       text,
  CHECK (period_from <= period_to)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_periods_approved ON payroll_periods(organization_id, period_from, period_to) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_payroll_periods_org ON payroll_periods(organization_id, period_from DESC);
