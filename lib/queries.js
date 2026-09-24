// Data-access layer: raw SQL via the `pg` pool (lib/db.js), with mapper
// functions that translate snake_case columns back into the same
// camelCase shapes the UI already expected from the old in-memory Context
// (referral.clientName, visit.evv.clockIn, etc.) — the pages below barely
// changed shape, only where the data comes from.
//
// MULTI-TENANCY: every function here takes `organizationId` as its first
// argument and every query filters on it. This is the single most
// important rule in the app — no function may return or mutate a row for
// a different organization, even by accident. Callers get organizationId
// from the signed-in session (see actions/auth.js), never from user input.
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, pool } from '@/lib/db';
import { todayIso, isIsoDate, dayKeyForIso, mondayOf, getWeek, daysBetween } from '@/lib/calendar';
import { formatCentralTime, toUtcIso } from '@/lib/evv-mapping';
import { getComplianceProfile } from '@/lib/state-compliance';
import { distanceFeet, isVisitLocation, isValidLatLng, DEFAULT_HOME_RADIUS_FEET } from '@/lib/geo';
import {
  normalizeMedicaidId,
  normalizeDob,
  normalizeState,
  normalizeZip,
  normalizeText,
} from '@/lib/client-identity';

// --- mappers ---------------------------------------------------------

function mapReferral(row) {
  if (!row) return null;
  return {
    id: row.id,
    payer: row.payer,
    clientName: row.client_name,
    dob: row.dob,
    service: row.service,
    authHours: row.auth_hours,
    authNumber: row.auth_number,
    diagnosis: row.diagnosis,
    receivedDate: row.received_date,
    status: row.status,
    fax: row.fax,
  };
}

function mapCaregiver(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    hiredOn: row.hired_on,
    status: row.status,
    locationId: row.location_id,
  };
}

function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    payer: row.payer,
    authHours: row.auth_hours,
    authHoursNum: Number(row.auth_hours_num) || 0,
    intakeDate: row.intake_date,
    address: row.address,
    emergencyContact: row.emergency_contact,
    careNeeds: row.care_needs || [],
    assignedCaregiverId: row.assigned_caregiver_id,
    hhscIndividualNumber: row.hhsc_individual_number,
    locationId: row.location_id,
    medicaidId: row.medicaid_id || null,
    dateOfBirth: row.date_of_birth || null,
    addressLine1: row.address_line1 || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.zip || null,
    homeLat: row.home_lat ?? null,
    homeLng: row.home_lng ?? null,
    homeLocationSource: row.home_location_source || null,
    homeLocationSetAt: row.home_location_set_at || null,
    homeLocationSetBy: row.home_location_set_by || null,
  };
}

// Validates and cleans a client's EVV identity fields (see
// lib/client-identity.js). Throws a staff-readable Error on a bad value.
function buildClientIdentity(data) {
  const identity = {
    medicaidId: normalizeMedicaidId(data.medicaidId),
    dateOfBirth: normalizeDob(data.dateOfBirth),
    addressLine1: normalizeText(data.addressLine1),
    city: normalizeText(data.city),
    state: normalizeState(data.state),
    zip: normalizeZip(data.zip),
  };
  const cityLine = [identity.city, [identity.state, identity.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  identity.displayAddress = [identity.addressLine1, cityLine].filter(Boolean).join(', ') || null;
  return identity;
}

function isDuplicateMedicaidId(err) {
  return err?.code === '23505' && String(err?.constraint || '').includes('medicaid_id');
}
const DUPLICATE_MEDICAID_MESSAGE =
  'Another client in this agency already has that Medicaid ID. Check for a duplicate intake before continuing.';

function mapVisit(row) {
  if (!row) return null;
  const hasEvv = row.status !== 'scheduled' || row.evv_exception != null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    clientId: row.client_id,
    // Weekday key ('mon'…'sun'). Derived from service_date when the column
    // is empty (backlog rows). Pages match visits to a week by
    // serviceDate, never by this key alone.
    day: row.day || dayKeyForIso(row.service_date),
    serviceDate: row.service_date,
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    resolved: row.resolved,
    vmurSubmitted: row.vmur_submitted,
    serviceAuthorizationId: row.service_authorization_id,
    // Billable minutes after a 110 B downward adjustment; null = bill the
    // scheduled duration. See billableMinutes() below.
    billMinutes: row.bill_minutes ?? null,
    exportHold: row.evv_export_hold
      ? { reason: row.evv_export_hold_reason || null, by: row.evv_export_hold_by || null, at: row.evv_export_hold_at || null }
      : null,
    evv: hasEvv
      ? {
          clockIn: row.evv_clock_in,
          clockOut: row.evv_clock_out,
          // Authoritative captured values behind the display labels above —
          // see db/schema.sql's 2026-09-22 visits comment. clockInAt/
          // clockOutAt are real timestamps (not the "Just now" placeholder
          // this used to be); the lat/lng/accuracy fields are null when the
          // caregiver's device couldn't provide a location.
          clockInAt: row.evv_clock_in_at,
          clockInLat: row.evv_clock_in_lat,
          clockInLng: row.evv_clock_in_lng,
          clockInAccuracy: row.evv_clock_in_accuracy,
          clockOutAt: row.evv_clock_out_at,
          clockOutLat: row.evv_clock_out_lat,
          clockOutLng: row.evv_clock_out_lng,
          clockOutAccuracy: row.evv_clock_out_accuracy,
          clockInLocation: row.evv_clock_in_location || null,
          clockOutLocation: row.evv_clock_out_location || null,
          clockInDistanceFt: row.evv_clock_in_distance_ft ?? null,
          clockOutDistanceFt: row.evv_clock_out_distance_ft ?? null,
          method: row.evv_method,
          verified: row.evv_verified,
          exception: row.evv_exception,
          note: row.evv_note,
        }
      : null,
    tasks: row.tasks || [],
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    sender: row.sender,
    text: row.body,
    time: row.time,
    mine: row.mine,
  };
}

function mapAuthorization(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    payer: row.payer,
    caseId: row.case_id,
    referenceNumber: row.reference_number,
    serviceCode: row.service_code,
    serviceDescription: row.service_description,
    modifierCodes: row.modifier_codes,
    diagnosisCode: row.diagnosis_code,
    diagnosisDescription: row.diagnosis_description,
    totalHoursPerWeek: row.total_hours_per_week === null ? null : Number(row.total_hours_per_week),
    totalUnitsPerWeek: row.total_units_per_week === null ? null : Number(row.total_units_per_week),
    unitMinutes: row.unit_minutes,
    // Dollar rate per billed unit. `== null` deliberately also catches
    // `undefined`, which is what a MISSING column reads as — so if this
    // column ever goes missing again on a drifted database, the rate reads
    // as "no rate on file" rather than NaN silently poisoning every
    // revenue figure downstream.
    ratePerUnit: row.rate_per_unit == null ? null : Number(row.rate_per_unit),
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    purchasedTasks: row.purchased_tasks || [],
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapBillingLine(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name || undefined,
    visitId: row.visit_id,
    serviceAuthorizationId: row.service_authorization_id,
    serviceCode: row.service_code,
    units: Number(row.units) || 0,
    serviceDate: row.service_date,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapOrientation(row) {
  if (!row) return null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    clientId: row.client_id,
    orientationType: row.orientation_type,
    method: row.method,
    orientedOn: row.oriented_on,
    agencyRepName: row.agency_rep_name,
    status: row.status,
    notes: row.notes,
    signedVia: row.signed_via,
    envelopeId: row.envelope_id,
    createdAt: row.created_at,
    caregiverName: row.caregiver_name || undefined,
    clientName: row.client_name || undefined,
  };
}

// Locations are the franchise/branch unit under an organization — see the
// SCHEMA DRIFT WARNING and rationale comment above the `locations` table
// in db/schema.sql for why license-level fields stay org-wide while only
// operational data (caregivers, clients, and the revenue they generate)
// is location-scoped.
function mapLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    commissionRate: Number(row.commission_rate) || 0,
    status: row.status,
    createdAt: row.created_at,
  };
}

function requireOrgId(organizationId) {
  if (!organizationId) {
    throw new Error('organizationId is required — every query must be tenant-scoped.');
  }
}

// --- reads -------------------------------------------------------------

export async function getReferrals(organizationId) {
  requireOrgId(organizationId);
  const rows = await query('SELECT * FROM referrals WHERE organization_id = $1 ORDER BY id', [organizationId]);
  return rows.map(mapReferral);
}

export async function getReferral(organizationId, id) {
  requireOrgId(organizationId);
  return mapReferral(
    await queryOne('SELECT * FROM referrals WHERE organization_id = $1 AND id = $2', [organizationId, id])
  );
}

// A brand-new self-service agency has no fax/OCR pipeline yet (deferred —
// see the backlog) and no other way to get a referral into the system, so
// this is the manual front door: a coordinator/admin/location admin typing
// in what a fax or phone call would otherwise have supplied. Intake still
// runs its own full validation afterward — this only creates the referral
// record intake starts from, same shape as scripts/seed.mjs's fixtures.
export async function createReferral(organizationId, data) {
  requireOrgId(organizationId);
  const required = ['payer', 'clientName', 'dob', 'service', 'authHours', 'authNumber', 'diagnosis', 'receivedDate'];
  for (const key of required) {
    if (!String(data[key] || '').trim()) {
      throw new Error(`${key} is required.`);
    }
  }
  const id = randomUUID();
  await query(
    `INSERT INTO referrals (id, organization_id, payer, client_name, dob, service, auth_hours, auth_number, diagnosis, received_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new')`,
    [
      id,
      organizationId,
      data.payer.trim(),
      data.clientName.trim(),
      data.dob.trim(),
      data.service.trim(),
      data.authHours.trim(),
      data.authNumber.trim(),
      data.diagnosis.trim(),
      data.receivedDate.trim(),
    ]
  );
  return id;
}

export async function getClients(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM clients WHERE organization_id = $1 AND ($2::text IS NULL OR location_id = $2)
     ORDER BY created_at, id`,
    [organizationId, locationId]
  );
  return rows.map(mapClient);
}

export async function getClient(organizationId, id, locationId = null) {
  requireOrgId(organizationId);
  return mapClient(
    await queryOne(
      `SELECT * FROM clients WHERE organization_id = $1 AND id = $2 AND ($3::text IS NULL OR location_id = $3)`,
      [organizationId, id, locationId]
    )
  );
}

export async function getCaregivers(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM caregivers WHERE organization_id = $1 AND ($2::text IS NULL OR location_id = $2) ORDER BY id`,
    [organizationId, locationId]
  );
  return rows.map(mapCaregiver);
}

export async function getCaregiver(organizationId, id, locationId = null) {
  requireOrgId(organizationId);
  return mapCaregiver(
    await queryOne(
      `SELECT * FROM caregivers WHERE organization_id = $1 AND id = $2 AND ($3::text IS NULL OR location_id = $3)`,
      [organizationId, id, locationId]
    )
  );
}

// Visits and billing_lines deliberately do NOT get their own location_id
// column (see db/schema.sql) — location is derived by joining through
// clients (or caregivers, for the by-caregiver query) at read time, so
// there's no denormalized copy that can drift from the client's/caregiver's
// actual location.
export async function getVisits(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT v.* FROM visits v
     JOIN clients c ON c.id = v.client_id
     WHERE v.organization_id = $1 AND ($2::text IS NULL OR c.location_id = $2)
     ORDER BY v.service_date, v.start_time`,
    [organizationId, locationId]
  );
  return rows.map(mapVisit);
}

export async function getVisit(organizationId, id, locationId = null) {
  requireOrgId(organizationId);
  return mapVisit(
    await queryOne(
      `SELECT v.* FROM visits v
       JOIN clients c ON c.id = v.client_id
       WHERE v.organization_id = $1 AND v.id = $2 AND ($3::text IS NULL OR c.location_id = $3)`,
      [organizationId, id, locationId]
    )
  );
}

export async function getVisitsForCaregiver(organizationId, caregiverId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT v.* FROM visits v
     JOIN caregivers cg ON cg.id = v.caregiver_id
     WHERE v.organization_id = $1 AND v.caregiver_id = $2 AND ($3::text IS NULL OR cg.location_id = $3)
     ORDER BY v.service_date, v.start_time`,
    [organizationId, caregiverId, locationId]
  );
  return rows.map(mapVisit);
}

// There was previously NO way for anyone — admin, coordinator, or
// caregiver — to put a new visit on the schedule: clockIn/clockOut both
// operate on a visitId that already exists, and every visit in the
// codebase came from scripts/seed.mjs or a QA fixture. That meant a
// brand-new client (see the manual referral-entry fix) had no path from
// "assigned a caregiver" to an actual EVV clock-in — the same class of
// dead end fax/OCR intake left behind, just one step further down the
// pipeline. This is the fix: a real write path, validated the same way
// every other location-sensitive writer in this file is.
//
// The visit's date is a real calendar date (2026-09-24: this used to be a
// key into the fixed demo week in lib/data.js). Callers pass
// `serviceDate` ('YYYY-MM-DD'); for older callers a weekday key (`day`)
// is still accepted and resolved against `weekStart` (a Monday) or the
// current week. `day` is always derived from the date, so the two can't
// drift apart.
//
// Allowed range: back as far as the visit-maintenance window (a visit that
// happened but was never scheduled can still be entered and then
// documented), and up to a year ahead.
const SCHEDULE_MAX_DAYS_AHEAD = 365;
const TIME_LABEL_RE = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;

export async function createVisit(organizationId, data, locationId = null) {
  requireOrgId(organizationId);
  const caregiver = await getCaregiver(organizationId, data.caregiverId, locationId);
  if (!caregiver) throw new Error('Caregiver not found.');
  const client = await getClient(organizationId, data.clientId, locationId);
  if (!client) throw new Error('Client not found.');

  let serviceDate = data.serviceDate ? String(data.serviceDate).trim() : null;
  if (!serviceDate && data.day) {
    const weekStart = isIsoDate(data.weekStart) ? mondayOf(data.weekStart) : mondayOf(todayIso());
    serviceDate = getWeek(weekStart).find((d) => d.key === data.day)?.iso || null;
  }
  if (!serviceDate || !isIsoDate(serviceDate)) throw new Error('Pick the date of the visit.');
  const offset = daysBetween(todayIso(), serviceDate);
  const organization = await getOrganization(organizationId);
  const backWindow = getMaintenanceWindowDays(organization);
  if (offset < -backWindow) {
    throw new Error(`That date is more than ${backWindow} days ago — past the visit maintenance window.`);
  }
  if (offset > SCHEDULE_MAX_DAYS_AHEAD) throw new Error('Visits can be scheduled up to a year ahead.');

  const startTime = String(data.startTime || '').trim();
  const endTime = String(data.endTime || '').trim();
  if (!TIME_LABEL_RE.test(startTime)) throw new Error('Start time must look like "9:00 AM".');
  if (!TIME_LABEL_RE.test(endTime)) throw new Error('End time must look like "5:00 PM".');

  // Which authorization this visit bills against. A client can
  // legitimately have more than one approved authorization at once (PAS
  // attendant care and a separate respite authorization, say) — when that
  // is the case an explicit pick is required rather than letting
  // generateBillingLineForVisit guess later via getActiveAuthorization,
  // which cannot know which service was actually scheduled. With zero or
  // exactly one active authorization there is nothing to disambiguate, so
  // the pick stays optional.
  let serviceAuthorizationId = data.serviceAuthorizationId || null;
  if (serviceAuthorizationId) {
    const auth = await queryOne(
      'SELECT id FROM service_authorizations WHERE id = $1 AND organization_id = $2 AND client_id = $3',
      [serviceAuthorizationId, organizationId, data.clientId]
    );
    if (!auth) throw new Error('That service authorization does not belong to this client.');
  } else {
    const activeAuths = await query(
      `SELECT id FROM service_authorizations WHERE organization_id = $1 AND client_id = $2 AND status = 'approved'`,
      [organizationId, data.clientId]
    );
    if (activeAuths.length > 1) {
      throw new Error('This client has more than one active authorization — pick which service this visit is for.');
    }
  }

  const id = randomUUID();
  await query(
    `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status, service_authorization_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)`,
    [id, organizationId, data.caregiverId, data.clientId, dayKeyForIso(serviceDate), serviceDate, startTime.toUpperCase(), endTime.toUpperCase(), serviceAuthorizationId]
  );
  return id;
}

export async function getMessagesForCaregiver(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const rows = await query(
    'SELECT * FROM messages WHERE organization_id = $1 AND caregiver_id = $2 ORDER BY created_at',
    [organizationId, caregiverId]
  );
  return rows.map(mapMessage);
}

// --- organization staff (office users, not caregivers) --------------------
//
// Until 2026-09-17 there was no way to create an ADMIN or COORDINATOR
// through the UI at all — the only tenant-side account creation path was
// createCaregiverWithLogin. That made LOCATION_ADMIN unusable the moment it
// was added, so these exist to let an organization admin staff its own
// locations.

function mapOrgUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    locationId: row.location_id,
    locationName: row.location_name || null,
    caregiverId: row.caregiver_id,
    createdAt: row.created_at,
    active: row.active !== false,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || null,
    deactivatedAt: row.deactivated_at || null,
  };
}

// Office staff only — caregiver logins are deliberately excluded, since
// they are managed from the caregiver roster with their HR record rather
// than as an account in a staff list.
export async function getOrgStaff(organizationId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT u.*, loc.name AS location_name
     FROM users u
     LEFT JOIN locations loc ON loc.id = u.location_id
     WHERE u.organization_id = $1 AND u.role <> 'CAREGIVER'
     ORDER BY u.role, u.name`,
    [organizationId]
  );
  return rows.map(mapOrgUser);
}

// Creating an office account. `locationId` is required for LOCATION_ADMIN
// and must be null for ADMIN — an organization admin scoped to one
// location would be a contradiction, and a location admin without one
// would silently hold organization-wide access, which is the failure mode
// worth being strict about. Both are enforced here as well as in
// actions/team.js, since a Server Action is a public endpoint.
export async function createOrgUser(organizationId, data) {
  requireOrgId(organizationId);
  const role = data.role;
  if (!['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR'].includes(role)) {
    throw new Error(`createOrgUser: unsupported role "${role}".`);
  }
  if (role === 'LOCATION_ADMIN' && !data.locationId) {
    throw new Error('A location admin must be assigned to a location.');
  }
  if (role === 'ADMIN' && data.locationId) {
    throw new Error('An organization admin is organization-wide and cannot be scoped to a location.');
  }
  // A location id handed in by a caller must belong to THIS organization —
  // never trust it just because the session is in the right tenant.
  if (data.locationId) {
    const location = await getLocation(organizationId, data.locationId);
    if (!location) throw new Error('Location not found.');
  }
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, organization_id, email, password_hash, name, role, location_id, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
    [id, organizationId, data.email.toLowerCase(), data.passwordHash, data.name, role, data.locationId || null]
  );
  return id;
}

// --- locations / franchise ------------------------------------------------

// `activeOnly` is for the selects that assign NEW records (hiring a
// caregiver, intake, staffing a location): a retired branch must not be a
// valid destination for new work, while the Locations admin page and the
// reassignment controls still need to list it.
export async function getLocations(organizationId, { activeOnly = false } = {}) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM locations WHERE organization_id = $1 AND ($2::boolean = false OR status = 'active')
     ORDER BY name`,
    [organizationId, activeOnly]
  );
  return rows.map(mapLocation);
}

export async function getLocation(organizationId, id) {
  requireOrgId(organizationId);
  return mapLocation(
    await queryOne('SELECT * FROM locations WHERE organization_id = $1 AND id = $2', [organizationId, id])
  );
}

export async function createLocation(organizationId, data) {
  requireOrgId(organizationId);
  const id = randomUUID();
  await query(
    `INSERT INTO locations (id, organization_id, name, commission_rate, status)
     VALUES ($1,$2,$3,$4,'active')`,
    [id, organizationId, data.name, data.commissionRate ?? 0]
  );
  return id;
}

// Configuring a location after creation. Commission terms get
// renegotiated and branches get retired, so create-only was not survivable
// for a franchise model. Every field is optional — only what is passed is
// written.
export async function updateLocation(organizationId, id, data) {
  requireOrgId(organizationId);
  const existing = await getLocation(organizationId, id);
  if (!existing) throw new Error('Location not found.');
  const sets = [];
  const params = [organizationId, id];
  if (data.name !== undefined) {
    params.push(data.name);
    sets.push(`name = $${params.length}`);
  }
  if (data.commissionRate !== undefined) {
    params.push(data.commissionRate);
    sets.push(`commission_rate = $${params.length}`);
  }
  if (data.status !== undefined) {
    params.push(data.status);
    sets.push(`status = $${params.length}`);
  }
  if (!sets.length) return;
  await query(
    `UPDATE locations SET ${sets.join(', ')} WHERE organization_id = $1 AND id = $2`,
    params
  );
}

// Moving an existing caregiver or client into a location. Needed because
// every row that predates the locations feature has location_id NULL, and
// locations are now mandatory for new records — without these, those rows
// would be permanently stranded outside every location.
export async function setCaregiverLocation(organizationId, caregiverId, locationId) {
  requireOrgId(organizationId);
  if (locationId) {
    const location = await getLocation(organizationId, locationId);
    if (!location) throw new Error('Location not found.');
  }
  await query(
    'UPDATE caregivers SET location_id = $1 WHERE organization_id = $2 AND id = $3',
    [locationId || null, organizationId, caregiverId]
  );
  // Keep the caregiver's own login in step — their session is scoped from
  // users.location_id, not from the caregiver row.
  await query(
    'UPDATE users SET location_id = $1 WHERE organization_id = $2 AND caregiver_id = $3',
    [locationId || null, organizationId, caregiverId]
  );
}

export async function setClientLocation(organizationId, clientId, locationId) {
  requireOrgId(organizationId);
  if (locationId) {
    const location = await getLocation(organizationId, locationId);
    if (!location) throw new Error('Location not found.');
  }
  await query(
    'UPDATE clients SET location_id = $1 WHERE organization_id = $2 AND id = $3',
    [locationId || null, organizationId, clientId]
  );
}

// Franchise/commission rollup for the org admin: per-location billed
// revenue (units × the authorization's rate_per_unit) and the commission
// the agency earns on it. A billing line whose authorization has no rate
// yet is counted separately as "unrated" and excluded from the dollar
// total rather than treated as $0 revenue — see the SCHEMA DRIFT WARNING
// comment on service_authorizations.rate_per_unit in db/schema.sql, which
// deliberately avoids a global rate table (deferred-backlog.md already
// cautions that HHSC revises rates and a stale hardcoded rate is worse
// than none). Clients not assigned to any location (location_id null,
// i.e. served directly by the agency rather than through a partner) are
// intentionally excluded from this per-location breakdown.
export async function getLocationRevenueSummary(organizationId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT
       loc.id, loc.name, loc.commission_rate, loc.status,
       COUNT(bl.id) FILTER (WHERE sa.rate_per_unit IS NOT NULL) AS rated_line_count,
       COUNT(bl.id) FILTER (WHERE bl.id IS NOT NULL AND sa.rate_per_unit IS NULL) AS unrated_line_count,
       COALESCE(SUM(bl.units * sa.rate_per_unit) FILTER (WHERE sa.rate_per_unit IS NOT NULL), 0) AS revenue
     FROM locations loc
     LEFT JOIN clients c ON c.location_id = loc.id
     LEFT JOIN billing_lines bl ON bl.client_id = c.id
     LEFT JOIN service_authorizations sa ON sa.id = bl.service_authorization_id
     WHERE loc.organization_id = $1
     GROUP BY loc.id, loc.name, loc.commission_rate, loc.status
     ORDER BY loc.name`,
    [organizationId]
  );
  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const commissionRate = Number(row.commission_rate) || 0;
    return {
      id: row.id,
      name: row.name,
      commissionRate,
      status: row.status,
      revenue,
      commissionAmount: Math.round(revenue * (commissionRate / 100) * 100) / 100,
      ratedLineCount: Number(row.rated_line_count) || 0,
      unratedLineCount: Number(row.unrated_line_count) || 0,
    };
  });
}

// --- writes --------------------------------------------------------------

export async function submitIntake(organizationId, referralId, formData) {
  requireOrgId(organizationId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const referral = mapReferral(
      (
        await client.query('SELECT * FROM referrals WHERE organization_id = $1 AND id = $2 FOR UPDATE', [
          organizationId,
          referralId,
        ])
      ).rows[0]
    );
    if (!referral) throw new Error('Referral not found');

    if (formData.locationId) {
      const location = mapLocation(
        (await client.query('SELECT * FROM locations WHERE organization_id = $1 AND id = $2', [
          organizationId,
          formData.locationId,
        ])).rows[0]
      );
      if (!location) throw new Error('Location not found.');
      if (location.status !== 'active') throw new Error('That location is inactive — reactivate it before completing intake into it.');
    }

    // Validate identity fields BEFORE marking the referral completed, so a
    // typo in the Medicaid ID or DOB leaves nothing half-done. The form's
    // DOB defaults to the referral's; if the form sends none, fall back to
    // the referral's only when it's readable (a messy OCR'd referral date
    // must not block intake — staff can fix it on the care-plan page).
    let referralDob = null;
    try {
      referralDob = normalizeDob(referral.dob);
    } catch {
      referralDob = null;
    }
    const identity = buildClientIdentity({
      medicaidId: formData.memberId,
      dateOfBirth: formData.dob ? formData.dob : referralDob,
      addressLine1: formData.address,
      city: formData.city,
      state: formData.state,
      zip: formData.zip,
    });

    await client.query("UPDATE referrals SET status = 'completed' WHERE organization_id = $1 AND id = $2", [
      organizationId,
      referralId,
    ]);

    const authHours = formData.authHours || referral.authHours;
    const parsedHours = parseFloat(String(authHours).replace(/[^0-9.]/g, '')) || 0;
    const clientId = 'c-' + referralId;

    await client.query(
      `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date, address, emergency_contact, care_needs, assigned_caregiver_id, from_referral_id, location_id,
                            medicaid_id, date_of_birth, address_line1, city, state, zip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO NOTHING`,
      [
        clientId,
        organizationId,
        formData.clientName || referral.clientName,
        formData.payerName || referral.payer,
        authHours,
        parsedHours,
        new Date().toLocaleDateString('en-US'),
        // cityStateZip is the pre-2026-09-23 single free-text field; kept so
        // an older form submission still produces a display address.
        identity.displayAddress || [formData.address, formData.cityStateZip].filter(Boolean).join(', ') || null,
        formData.ecName ? `${formData.ecName}${formData.ecRelationship ? ` (${formData.ecRelationship})` : ''}${formData.ecPhone ? ` · ${formData.ecPhone}` : ''}` : null,
        JSON.stringify(formData.careNeeds || []),
        null,
        referralId,
        formData.locationId || null,
        identity.medicaidId,
        identity.dateOfBirth,
        identity.addressLine1,
        identity.city,
        identity.state,
        identity.zip,
      ]
    );

    await client.query('COMMIT');
    return { clientName: referral.clientName };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isDuplicateMedicaidId(err)) throw new Error(DUPLICATE_MEDICAID_MESSAGE);
    throw err;
  } finally {
    client.release();
  }
}

// The `if (locationId)` guards below are defense-in-depth for location-
// scoped staff: they reuse the already-location-filtered getter and its
// "not found" semantics also to mean "not in your location" — a
// location-scoped caller can never learn whether the id exists in a
// different location, it just fails the same way as a bad id. Passing
// locationId = null (org admin, or any pre-existing call site left
// unchanged) skips the check entirely, preserving current behavior.
// Sets a client's EVV identity fields (Medicaid ID, DOB, structured
// address) from the care-plan page. Every field is replaced with what was
// submitted — a blank clears it. Returns the names of the fields whose
// value actually changed, for the audit log (names only; the values are
// PHI and don't belong in audit_log.detail).
export async function updateClientEvvIdentity(organizationId, clientId, data, locationId = null) {
  requireOrgId(organizationId);
  const existing = await getClient(organizationId, clientId, locationId);
  if (!existing) throw new Error('Client not found.');
  const identity = buildClientIdentity(data);

  const changed = ['medicaidId', 'dateOfBirth', 'addressLine1', 'city', 'state', 'zip'].filter(
    (key) => (existing[key] || null) !== identity[key]
  );
  if (changed.length === 0) return [];

  const hasStructuredAddress = identity.addressLine1 || identity.city || identity.state || identity.zip;
  try {
    await query(
      `UPDATE clients
          SET medicaid_id = $3, date_of_birth = $4, address_line1 = $5, city = $6, state = $7, zip = $8,
              address = CASE WHEN $9::boolean THEN $10 ELSE address END
        WHERE organization_id = $1 AND id = $2`,
      [
        organizationId,
        clientId,
        identity.medicaidId,
        identity.dateOfBirth,
        identity.addressLine1,
        identity.city,
        identity.state,
        identity.zip,
        Boolean(hasStructuredAddress),
        identity.displayAddress,
      ]
    );
  } catch (err) {
    if (isDuplicateMedicaidId(err)) throw new Error(DUPLICATE_MEDICAID_MESSAGE);
    throw err;
  }
  return changed;
}

export async function assignCaregiver(organizationId, clientId, caregiverId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const client = await getClient(organizationId, clientId, locationId);
    if (!client) throw new Error('Client not found in this location.');
  }
  await query('UPDATE clients SET assigned_caregiver_id = $1 WHERE organization_id = $2 AND id = $3', [
    caregiverId || null,
    organizationId,
    clientId,
  ]);
}

export async function toggleCaregiverStatus(organizationId, caregiverId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const caregiver = await getCaregiver(organizationId, caregiverId, locationId);
    if (!caregiver) throw new Error('Caregiver not found in this location.');
  }
  await query(
    `UPDATE caregivers SET status = CASE WHEN status = 'active' THEN 'on-leave' ELSE 'active' END
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, caregiverId]
  );
}

// Resolving an exception changes what the state should hold for that visit,
// so it re-queues as an update rather than leaving the aggregator with the
// pre-correction version.
export async function resolveVisitException(organizationId, visitId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const visit = await getVisit(organizationId, visitId, locationId);
    if (!visit) throw new Error('Visit not found in this location.');
  }
  await query('UPDATE visits SET resolved = true WHERE organization_id = $1 AND id = $2', [organizationId, visitId]);
  try {
    await enqueueEvvSync(organizationId, visitId, 'visit_update');
  } catch (err) {
    console.error('enqueueEvvSync (exception resolved) failed for visit', visitId, err);
  }
}

export async function submitVMUR(organizationId, visitId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const visit = await getVisit(organizationId, visitId, locationId);
    if (!visit) throw new Error('Visit not found in this location.');
  }
  await query(
    'UPDATE visits SET resolved = true, vmur_submitted = true WHERE organization_id = $1 AND id = $2',
    [organizationId, visitId]
  );
}

// geo (optional): { lat, lng, accuracy } captured client-side via
// navigator.geolocation immediately before this is called (see
// components/caregiver/ClockButton.js). Never required — a caregiver whose
// device denies location access, or is offline/indoors with no fix, still
// needs to be able to clock in; the visit is just recorded without
// coordinates and the method label reflects that (a real EVV exception, not
// a blocked clock-in).
// A GPS fix is only trusted to LEARN a client's home location when the
// device reports it as accurate to within this many meters.
const HOME_LEARN_MAX_ACCURACY_M = 50;

// Distance from the client's home for one clock event, learning the home
// location first if the client has none and this event qualifies (the
// caregiver says they're at the client's home and the fix is accurate).
async function distanceFromHome(organizationId, clientId, geo, category, visitId) {
  const hasGeo = geo && isValidLatLng(geo.lat, geo.lng);
  if (!hasGeo) return null;
  const client = await getClient(organizationId, clientId);
  if (!client) return null;
  if (client.homeLat === null || client.homeLng === null) {
    const accurate = Number.isFinite(geo.accuracy) && geo.accuracy <= HOME_LEARN_MAX_ACCURACY_M;
    if (category === 'member_home' && accurate) {
      await query(
        `UPDATE clients SET home_lat = $3, home_lng = $4, home_location_source = 'learned',
                home_location_set_at = now(), home_location_set_by = $5
          WHERE organization_id = $1 AND id = $2 AND home_lat IS NULL`,
        [organizationId, clientId, geo.lat, geo.lng, `GPS clock-in, visit ${visitId}`]
      );
      return 0;
    }
    return null;
  }
  return distanceFeet(geo.lat, geo.lng, client.homeLat, client.homeLng);
}

// category: where the caregiver says they are — one of lib/geo.js
// VISIT_LOCATIONS (Vesta's Member Home / Family Home / Neighbor Home /
// Community / Other). Defaults to the client's home.
export async function clockIn(organizationId, visitId, locationId = null, geo = null, category = 'member_home') {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId, locationId);
  if (!visit) throw new Error(locationId ? 'Visit not found in this location.' : 'Visit not found.');
  const now = new Date();
  const hasGeo = geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng);
  const method = hasGeo ? 'GPS mobile check-in' : 'Mobile check-in (no location)';
  const where = isVisitLocation(category) ? category : 'member_home';
  const distance = await distanceFromHome(organizationId, visit.clientId, geo, where, visitId);
  await query(
    `UPDATE visits SET status = 'in-progress', evv_clock_in = $3, evv_clock_out = NULL,
       evv_clock_in_at = $4, evv_clock_in_lat = $5, evv_clock_in_lng = $6, evv_clock_in_accuracy = $7,
       evv_clock_out_at = NULL, evv_clock_out_lat = NULL, evv_clock_out_lng = NULL, evv_clock_out_accuracy = NULL,
       evv_method = $8, evv_verified = false, evv_exception = NULL,
       evv_clock_in_location = $9, evv_clock_in_distance_ft = $10,
       evv_clock_out_location = NULL, evv_clock_out_distance_ft = NULL
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      visitId,
      formatCentralTime(now),
      now,
      hasGeo ? geo.lat : null,
      hasGeo ? geo.lng : null,
      hasGeo && Number.isFinite(geo.accuracy) ? geo.accuracy : null,
      method,
      where,
      distance,
    ]
  );
}

// geo (optional): see the comment on clockIn — same contract, never
// blocks clock-out.
export async function clockOut(organizationId, visitId, locationId = null, geo = null, category = 'member_home') {
  requireOrgId(organizationId);
  // Always fetched now (previously only when locationId was given) — the
  // flexible-hours check below needs the visit's own serviceDate/end
  // regardless of whether a location scope was passed.
  const existingVisit = await getVisit(organizationId, visitId, locationId);
  if (locationId && !existingVisit) throw new Error('Visit not found in this location.');
  const now = new Date();
  const hasGeo = geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng);

  // Flexible-hours grace-period check — added 2026-09-23, per-org (see
  // organizations.flexible_hours_enabled/flexible_hours_grace_minutes in
  // db/schema.sql and vesta-evv-feature-reference.md's "Made configurable,
  // per-organization" section). When the org has this enabled, a
  // clock-out within the configured grace window of the visit's
  // SCHEDULED end time is clean; later than that raises Texas reason code
  // 110A ("Service Delivery Exception — schedule variance",
  // lib/state-compliance.js) with resolved = false so it surfaces on
  // /admin/evv exactly like any other open exception, clearable through
  // the existing resolveVisitException flow. Deliberately does not block
  // or delay the clock-out itself — same "never block on a compliance
  // check" principle clockIn/clockOut already follow for missing GPS.
  let scheduleException = null;
  let scheduleNote = null;
  if (existingVisit) {
    const org = await getOrganization(organizationId);
    if (org?.flexibleHoursEnabled) {
      const scheduledEndIso = toUtcIso(existingVisit.serviceDate, existingVisit.end);
      if (scheduledEndIso) {
        const scheduledEndMs = new Date(scheduledEndIso + 'Z').getTime();
        const graceMs = (org.flexibleHoursGraceMinutes ?? 20) * 60000;
        const lateMs = now.getTime() - (scheduledEndMs + graceMs);
        if (Number.isFinite(scheduledEndMs) && lateMs > 0) {
          scheduleException = '110A';
          scheduleNote = `Clocked out ${Math.round(lateMs / 60000)} min past the scheduled end time (${org.flexibleHoursGraceMinutes ?? 20}-min grace period).`;
        }
      }
    }
  }

  const where = isVisitLocation(category) ? category : 'member_home';
  const distance = existingVisit
    ? await distanceFromHome(organizationId, existingVisit.clientId, geo, where, visitId)
    : null;
  await query(
    `UPDATE visits SET status = 'completed', resolved = $8, evv_clock_out = $3, evv_verified = true,
       evv_clock_out_at = $4, evv_clock_out_lat = $5, evv_clock_out_lng = $6, evv_clock_out_accuracy = $7,
       evv_exception = $9, evv_note = $10,
       evv_clock_out_location = $11, evv_clock_out_distance_ft = $12
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      visitId,
      formatCentralTime(now),
      now,
      hasGeo ? geo.lat : null,
      hasGeo ? geo.lng : null,
      hasGeo && Number.isFinite(geo.accuracy) ? geo.accuracy : null,
      scheduleException ? false : true,
      scheduleException,
      scheduleNote,
      where,
      distance,
    ]
  );

  // Compliance gate: once an agency's EVV transmission is actually 'live'
  // (real aggregator credentials, confirmed reliable), a billing line must
  // not be drafted from local clock-out alone — it has to wait for the
  // state aggregator to acknowledge the visit (see generateBillingLineForVisit's
  // caller in lib/evv-sync.js's pollTransactions). Any status short of
  // 'live' (not_started/testing/passed/disabled) means there's no
  // confirmed transmission to gate on yet, so billing keeps generating
  // from clock-out the way it always has — this is what keeps the demo
  // and pre-certification experience working unchanged.
  const evvCredentials = await getEvvCredentials(organizationId);
  const evvIsLive = evvCredentials?.status === 'live';
  if (!evvIsLive) {
    // Best-effort: draft a billing line from this completed visit so
    // finance staff see it queued for review, without blocking clock-out
    // if anything about billing generation goes wrong.
    try {
      await generateBillingLineForVisit(organizationId, visitId);
    } catch (err) {
      console.error('generateBillingLineForVisit failed for visit', visitId, err);
    }
  }

  // Queue the completed visit for transmission to the state EVV aggregator.
  // This only writes a row — the actual send happens in lib/evv-sync.js, so
  // a slow or unavailable aggregator can never delay a caregiver leaving a
  // client's home. When EVV is live, this is also what eventually triggers
  // billing generation once the row comes back acknowledged.
  try {
    await enqueueEvvSync(organizationId, visitId, 'visit_create');
  } catch (err) {
    console.error('enqueueEvvSync failed for visit', visitId, err);
  }
}

export async function toggleVisitTask(organizationId, visitId, taskId, locationId = null) {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId, locationId);
  if (!visit) return;
  const tasks = visit.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
  await query('UPDATE visits SET tasks = $1 WHERE organization_id = $2 AND id = $3', [
    JSON.stringify(tasks),
    organizationId,
    visitId,
  ]);
}

export async function sendCaregiverMessage(organizationId, caregiverId, senderName, text) {
  requireOrgId(organizationId);
  if (!text || !text.trim()) return;
  await query(
    `INSERT INTO messages (id, organization_id, caregiver_id, sender, body, time, mine) VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [randomUUID(), organizationId, caregiverId, senderName, text.trim(), 'Just now']
  );
}

// --- EVV aggregator credentials & sync log ------------------------------
//
// Credentials are returned with the encrypted blobs intact; only
// lib/hhaexchange.js decrypts them, server-side, at the moment of use.
// Nothing here ever hands plaintext to a page or component.

function mapCredentials(row) {
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    apiBaseUrl: row.api_base_url,
    apiVersion: row.api_version,
    clientIdEnc: row.client_id_enc,
    clientSecretEnc: row.client_secret_enc,
    scope: row.scope,
    providerTaxId: row.provider_tax_id,
    officeQualifier: row.office_qualifier,
    officeIdentifier: row.office_identifier,
    payerId: row.payer_id,
    environment: row.environment,
    aggregator: row.aggregator,
    status: row.status,
    lastSuccessAt: row.last_success_at,
  };
}

export async function getEvvCredentials(organizationId) {
  requireOrgId(organizationId);
  const row = await queryOne(
    'SELECT * FROM organization_evv_credentials WHERE organization_id = $1',
    [organizationId]
  );
  return mapCredentials(row);
}

export async function upsertEvvCredentials(organizationId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO organization_evv_credentials
       (organization_id, api_base_url, api_version, client_id_enc, client_secret_enc, scope,
        provider_tax_id, office_qualifier, office_identifier, payer_id, environment, aggregator, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (organization_id) DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url, api_version = EXCLUDED.api_version,
       client_id_enc = EXCLUDED.client_id_enc, client_secret_enc = EXCLUDED.client_secret_enc,
       scope = EXCLUDED.scope, provider_tax_id = EXCLUDED.provider_tax_id,
       office_qualifier = EXCLUDED.office_qualifier, office_identifier = EXCLUDED.office_identifier,
       payer_id = EXCLUDED.payer_id, environment = EXCLUDED.environment,
       aggregator = EXCLUDED.aggregator, status = EXCLUDED.status`,
    [
      organizationId, data.apiBaseUrl, data.apiVersion || '1', data.clientIdEnc,
      data.clientSecretEnc, data.scope || null, data.providerTaxId || null,
      data.officeQualifier || 'NPI', data.officeIdentifier || null, data.payerId || null,
      data.environment || 'sandbox', data.aggregator || 'hhaexchange', data.status || 'testing',
    ]
  );
}

export async function setEvvCredentialStatus(organizationId, status, { touchSuccess = false } = {}) {
  requireOrgId(organizationId);
  await query(
    `UPDATE organization_evv_credentials
     SET status = $1 ${touchSuccess ? ', last_success_at = now()' : ''}
     WHERE organization_id = $2`,
    [status, organizationId]
  );
}

// --- Tenant-side audit trail ---------------------------------------------
//
// One level down from platform_admin_access_log (see the Platform admin
// section below): that table only ever covers Hearth's own platform-ops
// staff, this one covers what a tenant's own users do inside their own
// organization. Scope started narrow on purpose — see each call site in
// actions/care-plans.js, actions/billing.js, and actions/evv.js — rather
// than instrumenting every mutation in the app at once. `entityType`/
// `entityId` name what was touched (e.g. 'service_authorization' / the
// new row's id) so a reader can go look at the real record; `detail` is
// short free text and must never carry a secret value (client id/secret,
// password) — every existing caller is careful about this, keep it that
// way if you add a new one.
export async function logAuditEvent(organizationId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO audit_log
       (id, organization_id, actor_user_id, actor_name, actor_role, location_id, action, entity_type, entity_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      organizationId,
      data.actorUserId || null,
      data.actorName,
      data.actorRole,
      data.locationId || null,
      data.action,
      data.entityType,
      data.entityId || null,
      data.detail || null,
    ]
  );
}

// Newest first, org-wide (the audit log page that reads this is ADMIN-only
// — see lib/permissions.js's admin.auditLog.view — so unlike most readers
// here this is deliberately not narrowed by locationId; a LOCATION_ADMIN's
// actions still show up on it with their location named, they just can't
// reach the page themselves).
export async function getAuditLog(organizationId, limit = 200) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT al.*, l.name AS location_name
     FROM audit_log al
     LEFT JOIN locations l ON l.id = al.location_id
     WHERE al.organization_id = $1
     ORDER BY al.created_at DESC
     LIMIT $2`,
    [organizationId, limit]
  );
  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    locationId: row.location_id,
    locationName: row.location_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

// --- DocuSign e-signature credentials ------------------------------------
//
// Same shape as the EVV credentials above: one row per tenant, private key
// encrypted at rest, decrypted only in lib/docusign.js at the moment of
// use. baa_on_file is a plain boolean flag an admin sets by hand once
// DocuSign has actually countersigned a BAA for this account — nothing
// here verifies that claim, it's a manual attestation that gates whether
// PHI-bearing documents (the Attendant Orientation) are allowed to go
// through DocuSign at all. See actions/docusign.js for where it's enforced.

function mapDocusignCredentials(row) {
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    integrationKey: row.integration_key,
    apiUsername: row.api_username,
    accountId: row.account_id,
    privateKeyEnc: row.private_key_enc,
    environment: row.environment,
    status: row.status,
    baaOnFile: row.baa_on_file,
    lastSuccessAt: row.last_success_at,
  };
}

export async function getDocusignCredentials(organizationId) {
  requireOrgId(organizationId);
  const row = await queryOne(
    'SELECT * FROM organization_docusign_credentials WHERE organization_id = $1',
    [organizationId]
  );
  return mapDocusignCredentials(row);
}

export async function upsertDocusignCredentials(organizationId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO organization_docusign_credentials
       (organization_id, integration_key, api_username, account_id, private_key_enc, environment, status, baa_on_file)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id) DO UPDATE SET
       integration_key = EXCLUDED.integration_key,
       api_username = EXCLUDED.api_username,
       account_id = EXCLUDED.account_id,
       private_key_enc = EXCLUDED.private_key_enc,
       environment = EXCLUDED.environment,
       status = EXCLUDED.status,
       baa_on_file = EXCLUDED.baa_on_file`,
    [
      organizationId,
      data.integrationKey,
      data.apiUsername,
      data.accountId,
      data.privateKeyEnc,
      data.environment || 'demo',
      data.status || 'testing',
      Boolean(data.baaOnFile),
    ]
  );
}

export async function setDocusignCredentialStatus(organizationId, status, { touchSuccess = false } = {}) {
  requireOrgId(organizationId);
  await query(
    `UPDATE organization_docusign_credentials
     SET status = $1 ${touchSuccess ? ', last_success_at = now()' : ''}
     WHERE organization_id = $2`,
    [status, organizationId]
  );
}

function mapSyncRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    visitId: row.visit_id,
    operation: row.operation,
    status: row.status,
    transactionId: row.transaction_id,
    evvmsId: row.evvms_id,
    attempts: row.attempts,
    lastError: row.last_error,
    payload: row.payload,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientName: row.client_name || undefined,
    caregiverName: row.caregiver_name || undefined,
    serviceDate: row.service_date || undefined,
  };
}

// Enqueue is intentionally forgiving: if a visit already has an unresolved
// row for the same operation we leave it alone rather than stacking
// duplicates, since the caregiver may tap twice or a retry may already be
// in flight.
export async function enqueueEvvSync(organizationId, visitId, operation) {
  requireOrgId(organizationId);
  const existing = await queryOne(
    `SELECT id FROM evv_sync_log
     WHERE organization_id = $1 AND visit_id = $2 AND operation = $3 AND status IN ('pending','sent')`,
    [organizationId, visitId, operation]
  );
  if (existing) return existing.id;

  const id = randomUUID();
  await query(
    `INSERT INTO evv_sync_log (id, organization_id, visit_id, operation, status, next_attempt_at)
     VALUES ($1,$2,$3,$4,'pending', now())`,
    [id, organizationId, visitId, operation]
  );
  return id;
}

export async function getSyncRowsDue(organizationId, limit = 25) {
  requireOrgId(organizationId);
  const rows = await query(
    // A visit the office has put ON HOLD (EVV Export page) is skipped until
    // released; its rows stay pending rather than failing.
    `SELECT s.* FROM evv_sync_log s
     LEFT JOIN visits v ON v.id = s.visit_id AND v.organization_id = s.organization_id
     WHERE s.organization_id = $1 AND s.status = 'pending'
       AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
       AND NOT COALESCE(v.evv_export_hold, false)
     ORDER BY s.created_at
     LIMIT $2`,
    [organizationId, limit]
  );
  return rows.map(mapSyncRow);
}

export async function getSyncRowsAwaiting(organizationId, limit = 25) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM evv_sync_log
     WHERE organization_id = $1 AND status = 'sent' AND transaction_id IS NOT NULL
     ORDER BY updated_at
     LIMIT $2`,
    [organizationId, limit]
  );
  return rows.map(mapSyncRow);
}

export async function getSyncLog(organizationId, limit = 100, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT s.*, c.name AS client_name, cg.name AS caregiver_name, v.service_date
     FROM evv_sync_log s
     LEFT JOIN visits v ON v.id = s.visit_id
     LEFT JOIN clients c ON c.id = v.client_id
     LEFT JOIN caregivers cg ON cg.id = v.caregiver_id
     WHERE s.organization_id = $1 AND ($3::text IS NULL OR c.location_id = $3)
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [organizationId, limit, locationId]
  );
  return rows.map(mapSyncRow);
}

export async function updateSyncRow(organizationId, id, patch) {
  requireOrgId(organizationId);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [col, val] of Object.entries({
    status: patch.status,
    transaction_id: patch.transactionId,
    evvms_id: patch.evvmsId,
    last_error: patch.lastError,
    payload: patch.payload === undefined ? undefined : JSON.stringify(patch.payload),
    next_attempt_at: patch.nextAttemptAt,
  })) {
    if (val !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
  }
  if (patch.incrementAttempts) sets.push('attempts = attempts + 1');
  sets.push('updated_at = now()');
  values.push(organizationId, id);
  await query(
    `UPDATE evv_sync_log SET ${sets.join(', ')} WHERE organization_id = $${i++} AND id = $${i}`,
    values
  );
}

// Retrying a failed row simply puts it back in the queue.
export async function retrySyncRow(organizationId, id) {
  requireOrgId(organizationId);
  await query(
    `UPDATE evv_sync_log
     SET status = 'pending', next_attempt_at = now(), last_error = NULL, updated_at = now()
     WHERE organization_id = $1 AND id = $2 AND status = 'failed'`,
    [organizationId, id]
  );
}

// --- Care Plan module (service authorizations) --------------------------
//
// A service authorization is the payer/MCO's own record of what a client
// is approved for (service code, units, date range, task list) — the
// shape of a real MCO "Authorization Notification" fax. It's now the
// source of truth office staff use to build a client's care plan and the
// caregiver's task checklist, instead of typing tasks in ad hoc per visit.

export async function getServiceAuthorizations(organizationId, clientId) {
  requireOrgId(organizationId);
  const rows = await query(
    'SELECT * FROM service_authorizations WHERE organization_id = $1 AND client_id = $2 ORDER BY start_date DESC, created_at DESC',
    [organizationId, clientId]
  );
  return rows.map(mapAuthorization);
}

export async function getAllServiceAuthorizations(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT sa.*, c.name AS client_name FROM service_authorizations sa
     JOIN clients c ON c.id = sa.client_id
     WHERE sa.organization_id = $1 AND ($2::text IS NULL OR c.location_id = $2)
     ORDER BY sa.status = 'approved' DESC, sa.end_date DESC`,
    [organizationId, locationId]
  );
  return rows.map((row) => ({ ...mapAuthorization(row), clientName: row.client_name }));
}

// The authorization currently in force for a client — approved, and
// today falls within [start_date, end_date] when both are present.
export async function getActiveAuthorization(organizationId, clientId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM service_authorizations
     WHERE organization_id = $1 AND client_id = $2 AND status = 'approved'
     ORDER BY end_date DESC, created_at DESC`,
    [organizationId, clientId]
  );
  const today = new Date().toISOString().slice(0, 10);
  const withinWindow = rows.find((r) => {
    const start = r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : null;
    const end = r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : null;
    return (!start || start <= today) && (!end || end >= today);
  });
  return mapAuthorization(withinWindow || rows[0] || null);
}

export async function createServiceAuthorization(organizationId, data) {
  requireOrgId(organizationId);
  const id = randomUUID();
  const unitMinutes = data.unitMinutes ?? 15;
  // Most Texas Medicaid/MCO authorization notices state hours/week, not
  // units/week — office staff naturally fill the field the fax actually
  // shows. Derive units/week from it when it isn't given explicitly, so an
  // authorization entered exactly as it appears on the payer notice still
  // feeds the Finance page's utilization tracking (which keys off
  // totalUnitsPerWeek) instead of silently vanishing from it.
  const totalUnitsPerWeek =
    data.totalUnitsPerWeek ??
    (data.totalHoursPerWeek != null && unitMinutes > 0
      ? Math.round((data.totalHoursPerWeek * 60) / unitMinutes)
      : null);
  await query(
    `INSERT INTO service_authorizations
       (id, organization_id, client_id, payer, case_id, reference_number, service_code,
        service_description, modifier_codes, diagnosis_code, diagnosis_description,
        total_hours_per_week, total_units_per_week, unit_minutes, frequency,
        start_date, end_date, status, purchased_tasks, notes, rate_per_unit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      id,
      organizationId,
      data.clientId,
      data.payer,
      data.caseId || null,
      data.referenceNumber || null,
      data.serviceCode,
      data.serviceDescription,
      data.modifierCodes || null,
      data.diagnosisCode || null,
      data.diagnosisDescription || null,
      data.totalHoursPerWeek ?? null,
      totalUnitsPerWeek,
      unitMinutes,
      data.frequency || 'Weekly',
      data.startDate,
      data.endDate,
      data.status || 'approved',
      JSON.stringify(data.purchasedTasks || []),
      data.notes || null,
      // Feeds getLocationRevenueSummary's per-location revenue and
      // commission. Null is meaningful, not a default: an authorization
      // with no rate on file is reported as an "unrated" billing line
      // rather than counted as $0 revenue.
      data.ratePerUnit ?? null,
    ]
  );
  return id;
}

// --- Finance module (billing lines) -------------------------------------
//
// A billing line is Hearth's own internal claim-line ledger — generated
// from a completed, EVV-tracked visit against whatever authorization
// covers it. This is the pre-clearinghouse view office/finance staff use
// to see what's ready to submit; a real clearinghouse integration (Stedi
// or equivalent, Phase 4) would read from this table rather than replace it.

// Whether a given visit already has a billing line — used to avoid drafting
// a duplicate when generation can now be triggered from two different
// places (immediate clock-out for non-live orgs, or EVV acknowledgment for
// live orgs) depending on when an agency's EVV status changes.
export async function getBillingLineByVisit(organizationId, visitId) {
  requireOrgId(organizationId);
  const row = await queryOne(
    'SELECT id FROM billing_lines WHERE organization_id = $1 AND visit_id = $2',
    [organizationId, visitId]
  );
  return row ? row.id : null;
}

// Completed visits with no billing line yet, for an agency whose EVV
// transmission is 'live' — i.e. visits genuinely waiting on state
// acknowledgment before a claim line can be drafted, not visits nobody has
// gotten to. Lets finance staff see this queue instead of a billing line
// simply never appearing with no explanation (the same "never silently
// swallowed" principle lib/evv-sync.js applies to failed transmissions).
export async function getVisitsAwaitingEvvConfirmation(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT v.*, c.name AS client_name, cg.name AS caregiver_name,
            s.status AS sync_status, s.last_error AS sync_error
     FROM visits v
     JOIN clients c ON c.id = v.client_id
     LEFT JOIN caregivers cg ON cg.id = v.caregiver_id
     LEFT JOIN billing_lines bl ON bl.visit_id = v.id
     LEFT JOIN evv_sync_log s ON s.visit_id = v.id AND s.operation = 'visit_create'
     WHERE v.organization_id = $1 AND v.status = 'completed' AND bl.id IS NULL
       AND ($2::text IS NULL OR c.location_id = $2)
     ORDER BY v.service_date, v.start_time`,
    [organizationId, locationId]
  );
  return rows.map((row) => ({
    ...mapVisit(row),
    clientName: row.client_name,
    caregiverName: row.caregiver_name,
    syncStatus: row.sync_status || 'pending',
    syncError: row.sync_error,
  }));
}

export async function getBillingLines(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT bl.*, c.name AS client_name FROM billing_lines bl
     JOIN clients c ON c.id = bl.client_id
     WHERE bl.organization_id = $1 AND ($2::text IS NULL OR c.location_id = $2)
     ORDER BY bl.service_date DESC, bl.created_at DESC`,
    [organizationId, locationId]
  );
  return rows.map((row) => ({ ...mapBillingLine(row), clientName: row.client_name }));
}

export async function createBillingLine(organizationId, data) {
  requireOrgId(organizationId);
  // A line with no authorization can never carry a rate, so it is invisible
  // to the franchise commission rollup forever. The auto-generated path
  // (generateBillingLineForVisit) always links one; the manual "add a line"
  // path on the Finance page never did — so every hand-entered line was
  // permanently "unrated" even for a client with a perfectly good rated
  // authorization on file. Default to the client's active authorization
  // when the caller supplies none. If the client genuinely has none, this
  // stays null and the line is correctly reported as unrated rather than
  // silently counted as $0.
  let serviceAuthorizationId = data.serviceAuthorizationId || null;
  if (!serviceAuthorizationId) {
    const active = await getActiveAuthorization(organizationId, data.clientId);
    serviceAuthorizationId = active?.id || null;
  }
  const id = randomUUID();
  await query(
    `INSERT INTO billing_lines
       (id, organization_id, client_id, visit_id, service_authorization_id, service_code, units, service_date, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      organizationId,
      data.clientId,
      data.visitId || null,
      serviceAuthorizationId,
      data.serviceCode,
      data.units,
      data.serviceDate,
      data.status || 'pending',
      data.notes || null,
    ]
  );
  return id;
}

export async function updateBillingLineStatus(organizationId, billingLineId, status) {
  requireOrgId(organizationId);
  await query('UPDATE billing_lines SET status = $1 WHERE organization_id = $2 AND id = $3', [
    status,
    organizationId,
    billingLineId,
  ]);
}

// Auto-generate a billing line from a just-completed visit, using the
// visit's scheduled duration (15-minute units, matching how PAS/attendant
// care codes like S5125 are billed) against whichever authorization is
// active for that client. Called from clockOut so EVV completion and
// billing stay linked, per the architecture spec's EVV/claims reconciliation
// principle — a line generated here still needs office review before
// submission, hence status 'pending' rather than 'ready'.
// What a visit bills for, in minutes: a 110 B downward adjustment if one
// was made in visit maintenance, otherwise the scheduled duration.
export function billableMinutes(visit) {
  if (visit?.billMinutes) return visit.billMinutes;
  return minutesBetween(visit?.start, visit?.end);
}

function minutesBetween(startLabel, endLabel) {
  const parse = (label) => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
    if (!m) return null;
    let [, h, min, ap] = m;
    h = parseInt(h, 10) % 12;
    if (ap.toUpperCase() === 'PM') h += 12;
    return h * 60 + parseInt(min, 10);
  };
  const start = parse(startLabel);
  const end = parse(endLabel);
  if (start === null || end === null) return null;
  return end >= start ? end - start : null;
}

export async function generateBillingLineForVisit(organizationId, visitId) {
  requireOrgId(organizationId);

  // Guard against double-drafting: this now runs from two call sites
  // (immediate clock-out for orgs without live EVV, and EVV acknowledgment
  // in lib/evv-sync.js for orgs that are live), and an agency's EVV status
  // could in principle change between a visit being enqueued and its sync
  // row resolving.
  const alreadyExists = await getBillingLineByVisit(organizationId, visitId);
  if (alreadyExists) return alreadyExists;

  const visit = mapVisit(
    await queryOne('SELECT * FROM visits WHERE organization_id = $1 AND id = $2', [organizationId, visitId])
  );
  if (!visit) return null;

  // Prefer the authorization picked at scheduling time (createVisit) —
  // unambiguous by construction. Falls back to the old best-effort guess
  // only for a visit that predates this column, or a client with no
  // authorization picked because none existed yet at scheduling time.
  const auth = visit.serviceAuthorizationId
    ? mapAuthorization(
        await queryOne(
          'SELECT * FROM service_authorizations WHERE organization_id = $1 AND id = $2',
          [organizationId, visit.serviceAuthorizationId]
        )
      )
    : await getActiveAuthorization(organizationId, visit.clientId);
  const unitMinutes = auth?.unitMinutes || 15;
  const minutes = billableMinutes(visit);
  const units = minutes ? Math.round(minutes / unitMinutes) : null;
  if (!units) return null; // can't compute a duration — leave for manual entry

  return createBillingLine(organizationId, {
    clientId: visit.clientId,
    visitId: visit.id,
    serviceAuthorizationId: auth?.id || null,
    serviceCode: auth?.serviceCode || 'UNSPECIFIED',
    units,
    serviceDate: visit.serviceDate,
    status: 'pending',
  });
}

// --- Attendant Orientation (per caregiver-client pairing) ----------------
//
// Required under 26 TAC §97 each time a caregiver is assigned to a client —
// not once per hire. The stored row holds only what is specific to the
// orientation event (type, method, date, who delivered it); the document
// itself is rendered from live data at view time, so the task list and
// schedule on it always reflect the current authorization and schedule
// rather than a stale copy taken at generation.

// --- Caregiver HR / credentialing ---------------------------------------
//
// Documents are one-time (signed stays signed); checks recur annually.
// DOC_TYPES and CHECK_TYPES are exported so the UI renders a complete
// checklist including items that have no row yet — an absent row is
// meaningful here ("never done"), not just missing data.

export const DOC_TYPES = [
  { key: 'application', label: 'Employment application' },
  { key: 'confidentiality', label: 'HIPAA / confidentiality agreement' },
  { key: 'handbook', label: 'Employee handbook acknowledgment' },
  { key: 'hep_b', label: 'Hepatitis B accept / decline' },
  { key: 'i9', label: 'Form I-9' },
  { key: 'tb_screening', label: 'TB screening' },
];

export const CHECK_TYPES = [
  { key: 'dps_criminal', label: 'DPS criminal history' },
  { key: 'emr', label: 'Employee Misconduct Registry' },
  { key: 'nar', label: 'Nurse Aide Registry' },
];

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    docType: row.doc_type,
    status: row.status,
    completedOn: row.completed_on,
    expiresOn: row.expires_on,
    fileReference: row.file_reference,
    notes: row.notes,
    signedVia: row.signed_via,
    envelopeId: row.envelope_id,
  };
}

function mapCheck(row) {
  if (!row) return null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    checkType: row.check_type,
    completedOn: row.completed_on,
    nextDueOn: row.next_due_on,
    performedBy: row.performed_by,
    result: row.result,
    notes: row.notes,
  };
}

export async function getCaregiverDocuments(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const rows = await query(
    'SELECT * FROM caregiver_documents WHERE organization_id = $1 AND caregiver_id = $2',
    [organizationId, caregiverId]
  );
  return rows.map(mapDocument);
}

// Note: signedVia/envelopeId default to 'office_recorded'/null whenever a
// caller doesn't pass them — which means the office-side "update a
// document" form (no knowledge of DocuSign) will reset a DocuSign-signed
// document's provenance back to office_recorded if someone hand-edits it
// afterward. That's an acceptable tradeoff for now: editing a signed
// document by hand is itself an unusual, office-driven action, and the
// alternative (silently preserving stale envelope_id across an edit that
// changes what's on file) seemed worse. Revisit if this surprises anyone.
export async function upsertCaregiverDocument(organizationId, caregiverId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO caregiver_documents (id, organization_id, caregiver_id, doc_type, status, completed_on, expires_on, notes, signed_via, envelope_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (caregiver_id, doc_type) DO UPDATE
       SET status = EXCLUDED.status,
           completed_on = EXCLUDED.completed_on,
           expires_on = EXCLUDED.expires_on,
           notes = EXCLUDED.notes,
           signed_via = EXCLUDED.signed_via,
           envelope_id = EXCLUDED.envelope_id`,
    [
      randomUUID(),
      organizationId,
      caregiverId,
      data.docType,
      data.status,
      data.completedOn || null,
      data.expiresOn || null,
      data.notes || null,
      data.signedVia || 'office_recorded',
      data.envelopeId || null,
    ]
  );
}

// The three no-PHI documents that make up the caregiver's e-signature
// packet — the source of truth for "the packet" everywhere it's
// referenced (getOnboardingState, the DocuSign envelope builder). Keep in
// sync with lib/esign-documents.js's PACKET_BUILDERS keys.
export const PACKET_DOC_TYPES = ['confidentiality', 'handbook', 'hep_b'];

// Called right after DocuSign accepts the envelope — marks all three
// packet documents 'sent' so the caregiver/admin UI shows "awaiting
// signature" rather than "not started" while the caregiver is off in the
// DocuSign signing view.
export async function markPacketSent(organizationId, caregiverId, envelopeId) {
  requireOrgId(organizationId);
  for (const docType of PACKET_DOC_TYPES) {
    await upsertCaregiverDocument(organizationId, caregiverId, {
      docType,
      status: 'sent',
      signedVia: 'docusign',
      envelopeId,
    });
  }
}

// Called once DocuSign's envelope status is confirmed 'completed' (from
// the signing-return route handler). Deliberately re-verified against the
// DocuSign API rather than trusted from the browser redirect alone — a
// caregiver's browser landing back on the return URL only means DocuSign
// sent them there, not that every tab was actually signed.
export async function markPacketSigned(organizationId, caregiverId, envelopeId) {
  requireOrgId(organizationId);
  const today = new Date().toISOString().slice(0, 10);
  for (const docType of PACKET_DOC_TYPES) {
    await upsertCaregiverDocument(organizationId, caregiverId, {
      docType,
      status: 'signed',
      completedOn: today,
      signedVia: 'docusign',
      envelopeId,
    });
  }
}

// Most recent check of each type for a caregiver. History is kept (a new
// row per annual re-check) but the UI cares about the latest one and when
// it next falls due.
export async function getLatestChecks(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT DISTINCT ON (check_type) * FROM caregiver_checks
     WHERE organization_id = $1 AND caregiver_id = $2
     ORDER BY check_type, completed_on DESC, created_at DESC`,
    [organizationId, caregiverId]
  );
  return rows.map(mapCheck);
}

// Roster-wide view of the latest check per caregiver per type, so the
// caregivers list can flag anyone overdue without an N+1 query.
export async function getAllLatestChecks(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT DISTINCT ON (ck.caregiver_id, ck.check_type) ck.* FROM caregiver_checks ck
     JOIN caregivers cg ON cg.id = ck.caregiver_id
     WHERE ck.organization_id = $1 AND ($2::text IS NULL OR cg.location_id = $2)
     ORDER BY ck.caregiver_id, ck.check_type, ck.completed_on DESC, ck.created_at DESC`,
    [organizationId, locationId]
  );
  return rows.map(mapCheck);
}

export async function recordCaregiverCheck(organizationId, caregiverId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO caregiver_checks (id, organization_id, caregiver_id, check_type, completed_on, next_due_on, performed_by, result, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      organizationId,
      caregiverId,
      data.checkType,
      data.completedOn,
      data.nextDueOn || null,
      data.performedBy || null,
      data.result || 'clear',
      data.notes || null,
    ]
  );
}

// --- Employment application ---------------------------------------------

function mapApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    positionApplied: row.position_applied,
    employmentType: row.employment_type,
    availableStart: row.available_start,
    workAuthorized: row.work_authorized,
    workedHereBefore: row.worked_here_before,
    reliableTransport: row.reliable_transport,
    driversLicense: row.drivers_license,
    criminalDisclosure: row.criminal_disclosure,
    criminalExplanation: row.criminal_explanation,
    hasPasExperience: row.has_pas_experience,
    experienceYears: row.experience_years,
    employers: row.employers || [],
    referencesList: row.references_list || [],
    daysAvailable: row.days_available || [],
    certifiedTrue: row.certified_true,
    submittedAt: row.submitted_at,
  };
}

export async function getApplication(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const row = await queryOne(
    'SELECT * FROM caregiver_applications WHERE organization_id = $1 AND caregiver_id = $2',
    [organizationId, caregiverId]
  );
  return mapApplication(row);
}

// Submitting also records the application as a completed onboarding
// document, so the office-side checklist and the caregiver's checklist
// never disagree about whether it's done.
export async function submitApplication(organizationId, caregiverId, data) {
  requireOrgId(organizationId);
  await query(
    `INSERT INTO caregiver_applications
       (id, organization_id, caregiver_id, full_name, date_of_birth, phone, email, address, city, state, zip,
        position_applied, employment_type, available_start, work_authorized, worked_here_before,
        reliable_transport, drivers_license, criminal_disclosure, criminal_explanation,
        has_pas_experience, experience_years, employers, references_list, days_available, certified_true)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     ON CONFLICT (caregiver_id) DO UPDATE SET
       full_name = EXCLUDED.full_name, date_of_birth = EXCLUDED.date_of_birth, phone = EXCLUDED.phone,
       email = EXCLUDED.email, address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state,
       zip = EXCLUDED.zip, position_applied = EXCLUDED.position_applied,
       employment_type = EXCLUDED.employment_type, available_start = EXCLUDED.available_start,
       work_authorized = EXCLUDED.work_authorized, worked_here_before = EXCLUDED.worked_here_before,
       reliable_transport = EXCLUDED.reliable_transport, drivers_license = EXCLUDED.drivers_license,
       criminal_disclosure = EXCLUDED.criminal_disclosure, criminal_explanation = EXCLUDED.criminal_explanation,
       has_pas_experience = EXCLUDED.has_pas_experience, experience_years = EXCLUDED.experience_years,
       employers = EXCLUDED.employers, references_list = EXCLUDED.references_list,
       days_available = EXCLUDED.days_available, certified_true = EXCLUDED.certified_true,
       submitted_at = now()`,
    [
      randomUUID(), organizationId, caregiverId, data.fullName, data.dateOfBirth || null,
      data.phone || null, data.email || null, data.address || null, data.city || null,
      data.state || null, data.zip || null, data.positionApplied || null, data.employmentType || null,
      data.availableStart || null, data.workAuthorized, data.workedHereBefore,
      data.reliableTransport, data.driversLicense, data.criminalDisclosure,
      data.criminalExplanation || null, data.hasPasExperience, data.experienceYears || null,
      JSON.stringify(data.employers || []), JSON.stringify(data.referencesList || []),
      JSON.stringify(data.daysAvailable || []), data.certifiedTrue === true,
    ]
  );

  await upsertCaregiverDocument(organizationId, caregiverId, {
    docType: 'application',
    status: 'signed',
    completedOn: new Date().toISOString().slice(0, 10),
  });
}

// --- Hiring -------------------------------------------------------------

// Creates a caregiver in `applicant` status together with the login they
// use to complete onboarding. Both rows are written in one transaction —
// a caregiver without a login can't onboard, and a login pointing at no
// caregiver is a broken account.
export async function createCaregiverWithLogin(organizationId, data) {
  requireOrgId(organizationId);
  if (data.locationId) {
    const location = await getLocation(organizationId, data.locationId);
    if (!location) throw new Error('Location not found.');
    if (location.status !== 'active') throw new Error('That location is inactive — reactivate it before hiring into it.');
  }
  const caregiverId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO caregivers (id, organization_id, name, role, phone, email, status, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,'applicant',$7)`,
      [caregiverId, organizationId, data.name, data.role, data.phone, data.email || null, data.locationId || null]
    );
    // The caregiver's own user row inherits location_id from the caregiver
    // at creation time (see db/schema.sql's comment on users.location_id) —
    // there's no separate UI moment to set it independently for a
    // CAREGIVER-role account.
    await client.query(
      `INSERT INTO users (id, organization_id, email, password_hash, name, role, caregiver_id, location_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,'CAREGIVER',$6,$7,true)`,
      [randomUUID(), organizationId, data.email.toLowerCase(), data.passwordHash, data.name, caregiverId, data.locationId || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return caregiverId;
}

// Everything the office needs to decide whether a caregiver may start
// work. Deliberately separate from the caregiver's own checklist: her
// finishing her paperwork is NOT the same as being cleared to work in
// Texas — the registry checks and I-9 are the agency's responsibility and
// are what actually gate a first shift.
export async function getOnboardingState(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const [application, documents, checks, courses, completions] = await Promise.all([
    getApplication(organizationId, caregiverId),
    getCaregiverDocuments(organizationId, caregiverId),
    getLatestChecks(organizationId, caregiverId),
    getCourses(organizationId),
    getCompletionsForCaregiver(organizationId, caregiverId),
  ]);

  const docBy = Object.fromEntries(documents.map((d) => [d.docType, d]));
  const signedPacket = PACKET_DOC_TYPES.every((t) =>
    ['signed', 'uploaded'].includes(docBy[t]?.status)
  );

  const initialCourses = courses.filter((c) => c.courseType === 'initial');
  const doneIds = new Set(completions.map((c) => c.courseId));
  // Vacuously true when the agency hasn't built out its "initial" course
  // library yet (initialCourses.length === 0) — a brand-new agency's first
  // caregiver must not get stuck at "Applicant" forever with no possible
  // action to take just because nobody has added a course. Once a course
  // exists, every() reverts to requiring it be completed, same as before.
  const trainingDone = initialCourses.every((c) => doneIds.has(c.id));

  const today = new Date().toISOString().slice(0, 10);
  const checksCurrent = CHECK_TYPES.every((t) => {
    const c = checks.find((x) => x.checkType === t.key);
    return c && (!c.nextDueOn || c.nextDueOn >= today) && c.result !== 'flagged';
  });
  const i9OnFile = ['signed', 'uploaded'].includes(docBy.i9?.status);

  return {
    application,
    // Caregiver's own three steps
    applicationSubmitted: Boolean(application),
    packetSigned: signedPacket,
    trainingComplete: trainingDone,
    trainingProgress: {
      done: initialCourses.filter((c) => doneIds.has(c.id)).length,
      total: initialCourses.length,
    },
    // Office-side prerequisites for actually starting work
    checksCurrent,
    i9OnFile,
    caregiverStepsComplete: Boolean(application) && signedPacket && trainingDone,
    readyToActivate:
      Boolean(application) && signedPacket && trainingDone && checksCurrent && i9OnFile,
  };
}

export async function setCaregiverStatus(organizationId, caregiverId, status) {
  requireOrgId(organizationId);
  await query('UPDATE caregivers SET status = $1 WHERE organization_id = $2 AND id = $3', [
    status,
    organizationId,
    caregiverId,
  ]);
}

// --- Training -----------------------------------------------------------

function mapCourse(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    durationMinutes: row.duration_minutes,
    hours: Number(row.hours) || 0,
    courseType: row.course_type,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

export async function getCourses(organizationId, { includeInactive = false } = {}) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM training_courses
     WHERE organization_id = $1 ${includeInactive ? '' : 'AND active = true'}
     ORDER BY sort_order, created_at`,
    [organizationId]
  );
  return rows.map(mapCourse);
}

export async function createCourse(organizationId, data) {
  requireOrgId(organizationId);
  const id = randomUUID();
  await query(
    `INSERT INTO training_courses (id, organization_id, title, description, video_url, duration_minutes, hours, course_type, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      organizationId,
      data.title,
      data.description || null,
      data.videoUrl || null,
      data.durationMinutes || null,
      data.hours || 0,
      data.courseType || 'initial',
      data.sortOrder || 0,
    ]
  );
  return id;
}

export async function getCompletionsForCaregiver(organizationId, caregiverId) {
  requireOrgId(organizationId);
  const rows = await query(
    'SELECT * FROM training_completions WHERE organization_id = $1 AND caregiver_id = $2',
    [organizationId, caregiverId]
  );
  return rows.map((r) => ({
    id: r.id,
    caregiverId: r.caregiver_id,
    courseId: r.course_id,
    completedAt: r.completed_at,
    hoursCredited: Number(r.hours_credited) || 0,
  }));
}

export async function getAllCompletions(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT tc.* FROM training_completions tc
     JOIN caregivers cg ON cg.id = tc.caregiver_id
     WHERE tc.organization_id = $1 AND ($2::text IS NULL OR cg.location_id = $2)`,
    [organizationId, locationId]
  );
  return rows.map((r) => ({
    caregiverId: r.caregiver_id,
    courseId: r.course_id,
    completedAt: r.completed_at,
    hoursCredited: Number(r.hours_credited) || 0,
  }));
}

// Marking complete credits the course's hours at the time of completion,
// so a later change to the course's hours value doesn't rewrite history.
export async function markCourseComplete(organizationId, caregiverId, courseId) {
  requireOrgId(organizationId);
  const course = mapCourse(
    await queryOne('SELECT * FROM training_courses WHERE organization_id = $1 AND id = $2', [
      organizationId,
      courseId,
    ])
  );
  if (!course) return;
  await query(
    `INSERT INTO training_completions (id, organization_id, caregiver_id, course_id, hours_credited)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (caregiver_id, course_id) DO NOTHING`,
    [randomUUID(), organizationId, caregiverId, courseId, course.hours]
  );
}

// The tenant agency itself — used on documents that must name the agency
// (the orientation form's "Agency Name" field), so the document reflects
// whichever tenant generated it rather than a hardcoded name.
export async function getOrganization(organizationId) {
  requireOrgId(organizationId);
  const row = await queryOne('SELECT * FROM organizations WHERE id = $1', [organizationId]);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    // Two-letter USPS state code — which state's Medicaid/EVV rules this
    // tenant operates under (see lib/state-compliance.js). Defaults to
    // 'TX' on existing rows via the migration; every tenant created since
    // has picked one explicitly at signup/onboarding.
    state: row.state,
    medicaidProviderNumber: row.medicaid_provider_number,
    npi: row.npi,
    stateLicenseNumber: row.state_license_number,
    providerEnrollmentAttested: row.provider_enrollment_attested,
    baaSigned: row.baa_signed,
    baaSignedAt: row.baa_signed_at,
    status: row.status,
    // Per-org "configurator" settings — added 2026-09-23, first entry.
    // See db/schema.sql's comment on these two columns and clockOut()
    // below for where flexibleHoursEnabled/flexibleHoursGraceMinutes are
    // actually applied.
    flexibleHoursEnabled: row.flexible_hours_enabled,
    flexibleHoursGraceMinutes: row.flexible_hours_grace_minutes,
    // Agency's own visit-maintenance deadline in days; null = the state's
    // window. Read it through getMaintenanceWindowDays, not directly.
    visitMaintenanceWindowDays: row.visit_maintenance_window_days ?? null,
    homeRadiusFeet: row.home_radius_feet ?? DEFAULT_HOME_RADIUS_FEET,
    createdAt: row.created_at,
  };
}

// Updates this org's flexible-hours configurator settings. No dedicated
// settings UI exists yet (2026-09-23) — this is the write path a future
// /admin settings page will call; for now it's exercised directly by QA
// and can be run one-off against a real org if needed. graceMinutes is
// validated here in addition to the schema's own CHECK constraint so a
// bad value fails with a clear message rather than a raw Postgres error.
export async function updateOrganizationFlexibleHours(organizationId, { enabled, graceMinutes }) {
  requireOrgId(organizationId);
  const minutes = Number(graceMinutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) {
    throw new Error('Grace period must be a whole number of minutes between 0 and 480.');
  }
  await query(
    'UPDATE organizations SET flexible_hours_enabled = $1, flexible_hours_grace_minutes = $2 WHERE id = $3',
    [Boolean(enabled), minutes, organizationId]
  );
}

// --- Tenant onboarding (architecture spec §5 / §7 Phase 3) ---------------
//
// This is the one legitimate exception to "every function takes an
// organizationId" — createOrganizationWithAdmin is what CREATES a tenant,
// so there isn't one yet to scope by. Everything else in this section
// still takes organizationId like normal.

// New-agency signup: creates the organizations row and its first ADMIN
// user together, in one transaction — an org with no login, or a login
// pointing at no org, would both be broken states. Mirrors the same
// transactional shape as createCaregiverWithLogin above.
export async function createOrganizationWithAdmin(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser) {
    throw new Error('An account with that email already exists — sign in instead.');
  }

  const organizationId = randomUUID();
  const userId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organizations
         (id, name, state, medicaid_provider_number, npi, state_license_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,'trial')`,
      [
        organizationId,
        data.organizationName,
        // 'TX' default mirrors the column's own default, for the (today
        // still Texas-only in practice) callers that don't pass one yet.
        data.state || 'TX',
        data.medicaidProviderNumber || null,
        data.npi || null,
        data.stateLicenseNumber || null,
      ]
    );
    await client.query(
      `INSERT INTO users (id, organization_id, email, password_hash, name, role, must_change_password)
       VALUES ($1,$2,$3,$4,$5,'ADMIN',true)`,
      [userId, organizationId, email, data.passwordHash, data.adminName]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { organizationId, userId };
}

// The onboarding checklist's editable fields — provider info can be filled
// in at signup or added later, and the two attestation flags are checked
// by the agency's own admin as each real-world step is actually completed
// (see the schema comment on `organizations` for why these are
// attestations rather than verified facts).
export async function updateOrganizationOnboarding(organizationId, patch) {
  requireOrgId(organizationId);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [col, val] of Object.entries({
    state: patch.state,
    medicaid_provider_number: patch.medicaidProviderNumber,
    npi: patch.npi,
    state_license_number: patch.stateLicenseNumber,
    provider_enrollment_attested: patch.providerEnrollmentAttested,
    baa_signed: patch.baaSigned,
    baa_signed_at: patch.baaSigned === undefined ? undefined : patch.baaSigned ? new Date() : null,
  })) {
    if (val !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push(organizationId);
  await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

// --- Platform admin (architecture spec §3) -------------------------------
//
// Everything below reads or writes the `platform_admins` /
// `platform_admin_access_log` tables, or reads *across* every tenant on
// purpose. This is the second deliberate exception to "every function
// takes organizationId and filters on it" (the first being
// createOrganizationWithAdmin above) — a platform admin isn't scoped to
// one agency by definition, so there is no organizationId to require here.
// getAllOrganizationsForPlatform in particular must never be called from
// anything reachable by an ADMIN/COORDINATOR/CAREGIVER session — only from
// app/platform/page.js, which gates on requireSession(['PLATFORM_ADMIN'])
// first. Do not reuse it, or the pattern it establishes, anywhere else.

function mapPlatformAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    active: row.active,
    platformRole: row.platform_role,
    createdAt: row.created_at,
  };
}

export async function getPlatformAdminByEmail(email) {
  const row = await queryOne('SELECT * FROM platform_admins WHERE email = $1', [
    String(email || '').trim().toLowerCase(),
  ]);
  return mapPlatformAdmin(row);
}

// Platform team management (app/platform/admins) — who else has
// PLATFORM_ADMIN access, distinct from getAllOrganizationsForPlatform
// above which lists agencies. Same "not scoped to one organizationId"
// family of query as everything else in this section.
export async function getAllPlatformAdmins() {
  const rows = await query('SELECT * FROM platform_admins ORDER BY created_at DESC');
  return rows.map(mapPlatformAdmin);
}

// Email uniqueness has to be checked against BOTH login tables, not just
// platform_admins — loginAction (actions/auth.js) checks `users` first and
// only falls back to platform_admins, so an email that already exists as a
// tenant user would silently be unreachable as a platform admin login.
//
// `platformRole` ('support' | 'full') is validated by the caller
// (actions/platform.js's createPlatformAdminAction) before it reaches
// here — this function trusts it, same convention as
// createOrganizationWithAdmin trusting its caller's inputs above.
export async function createPlatformAdmin({ name, email, passwordHash, platformRole }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existingUser) {
    throw new Error('An account with that email already exists — choose a different email.');
  }
  const existingAdmin = await queryOne('SELECT id FROM platform_admins WHERE email = $1', [
    normalizedEmail,
  ]);
  if (existingAdmin) {
    throw new Error('A platform admin with that email already exists.');
  }

  const id = randomUUID();
  await query(
    `INSERT INTO platform_admins (id, email, password_hash, name, platform_role) VALUES ($1, $2, $3, $4, $5)`,
    [id, normalizedEmail, passwordHash, name, platformRole]
  );
  return { id, email: normalizedEmail, name, platformRole };
}

export async function getPlatformAdminById(platformAdminId) {
  const row = await queryOne('SELECT * FROM platform_admins WHERE id = $1', [platformAdminId]);
  return mapPlatformAdmin(row);
}

// Used by togglePlatformAdminActiveAction's "don't lock the team out"
// guard: refuses to deactivate the last active 'full' platform admin,
// since a team with zero of those could never onboard another agency or
// manage its own roster again without falling back to
// scripts/create-platform-admin.mjs run directly against the database.
export async function countActiveFullPlatformAdmins() {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS count FROM platform_admins WHERE platform_role = 'full' AND active = true`
  );
  return row.count;
}

// Self-deactivation is blocked one layer up, in
// actions/platform.js's togglePlatformAdminActiveAction — this stays a
// plain, reusable write with no special-casing.
export async function setPlatformAdminActive(platformAdminId, active) {
  await query('UPDATE platform_admins SET active = $1 WHERE id = $2', [active, platformAdminId]);
}

// Called once per dashboard view (see app/platform/page.js) — the spec's
// "logged more heavily than normal admin access" requirement. `action` is
// a short fixed label ('view_dashboard' today); `detail` is free text for
// anything worth recording about that specific view (currently unused,
// kept for when a future action needs it).
export async function logPlatformAdminAccess(platformAdminId, action, detail = null) {
  await query(
    `INSERT INTO platform_admin_access_log (id, platform_admin_id, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), platformAdminId, action, detail]
  );
}

// Read-only, cross-tenant, by design (v1 of the platform dashboard has no
// write actions — see the schema comment on platform_admin_access_log).
// One row per agency with just enough EVV state joined in to answer "is
// this agency stuck, and where" without a second round trip per row.
function mapOrganizationForPlatform(row) {
  const providerInfoDone = Boolean(
    row.medicaid_provider_number && row.npi && row.state_license_number
  );
  const enrollmentDone = Boolean(row.provider_enrollment_attested);
  const baaDone = Boolean(row.baa_signed);
  const credentialsConfigured = row.evv_status !== null;
  const certificationPassed = row.evv_status === 'passed' || row.evv_status === 'live';
  const evvLive = row.evv_status === 'live';
  const onboardingStepsDone = [
    true, // account created
    providerInfoDone,
    enrollmentDone,
    baaDone,
    credentialsConfigured,
    certificationPassed,
    evvLive,
  ].filter(Boolean).length;

  return {
    id: row.id,
    name: row.name,
    state: row.state,
    status: row.status,
    createdAt: row.created_at,
    medicaidProviderNumber: row.medicaid_provider_number,
    npi: row.npi,
    stateLicenseNumber: row.state_license_number,
    providerInfoDone,
    enrollmentDone,
    baaDone,
    evvStatus: row.evv_status, // null | not_started | testing | passed | live | disabled
    evvEnvironment: row.evv_environment,
    evvAggregator: row.evv_aggregator,
    evvLastSuccessAt: row.evv_last_success_at,
    evvFailedCount: Number(row.evv_failed_count || 0),
    openExceptionCount: Number(row.open_exception_count || 0),
    credentialsConfigured,
    certificationPassed,
    evvLive,
    onboardingStepsDone,
    onboardingStepsTotal: 7,
    locationCount: Number(row.location_count || 0),
    caregiverTotalCount: Number(row.caregiver_total_count || 0),
    caregiverActiveCount: Number(row.caregiver_active_count || 0),
    caregiverPipelineCount: Number(row.caregiver_pipeline_count || 0),
    caregiverOnLeaveCount: Number(row.caregiver_on_leave_count || 0),
    billingPendingAmount: Number(row.billing_pending_amount || 0),
    billingUnratedCount: Number(row.billing_unrated_count || 0),
  };
}

export async function getAllOrganizationsForPlatform() {
  const rows = await query(
    `SELECT
       o.*,
       ec.status AS evv_status,
       ec.environment AS evv_environment,
       ec.aggregator AS evv_aggregator,
       ec.last_success_at AS evv_last_success_at,
       COALESCE(fail.failed_count, 0) AS evv_failed_count,
       COALESCE(exc.open_exception_count, 0) AS open_exception_count,
       COALESCE(loc.location_count, 0) AS location_count,
       COALESCE(cg.total_count, 0) AS caregiver_total_count,
       COALESCE(cg.active_count, 0) AS caregiver_active_count,
       COALESCE(cg.pipeline_count, 0) AS caregiver_pipeline_count,
       COALESCE(cg.on_leave_count, 0) AS caregiver_on_leave_count,
       COALESCE(rev.pending_amount, 0) AS billing_pending_amount,
       COALESCE(rev.unrated_count, 0) AS billing_unrated_count
     FROM organizations o
     LEFT JOIN organization_evv_credentials ec ON ec.organization_id = o.id
     LEFT JOIN (
       SELECT organization_id, COUNT(*) AS failed_count
       FROM evv_sync_log
       WHERE status = 'failed'
       GROUP BY organization_id
     ) fail ON fail.organization_id = o.id
     LEFT JOIN (
       SELECT organization_id, COUNT(*) AS open_exception_count
       FROM visits
       WHERE evv_exception IS NOT NULL AND resolved = false
       GROUP BY organization_id
     ) exc ON exc.organization_id = o.id
     LEFT JOIN (
       SELECT organization_id, COUNT(*) AS location_count
       FROM locations
       GROUP BY organization_id
     ) loc ON loc.organization_id = o.id
     LEFT JOIN (
       SELECT
         organization_id,
         COUNT(*) AS total_count,
         COUNT(*) FILTER (WHERE status = 'active') AS active_count,
         COUNT(*) FILTER (WHERE status IN ('applicant', 'onboarding')) AS pipeline_count,
         COUNT(*) FILTER (WHERE status = 'on-leave') AS on_leave_count
       FROM caregivers
       GROUP BY organization_id
     ) cg ON cg.organization_id = o.id
     LEFT JOIN (
       SELECT
         bl.organization_id,
         COALESCE(
           SUM(bl.units * sa.rate_per_unit) FILTER (WHERE bl.status = 'pending' AND sa.rate_per_unit IS NOT NULL),
           0
         ) AS pending_amount,
         COUNT(*) FILTER (WHERE sa.rate_per_unit IS NULL) AS unrated_count
       FROM billing_lines bl
       LEFT JOIN service_authorizations sa ON sa.id = bl.service_authorization_id
       GROUP BY bl.organization_id
     ) rev ON rev.organization_id = o.id
     ORDER BY o.created_at DESC`
  );
  return rows.map(mapOrganizationForPlatform);
}

// Billing snapshot — pending/paid dollar totals plus an unrated-line
// count, used by both the agency's own dashboard (app/admin/page.js,
// locationId-scoped like every other location-sensitive reader) and the
// platform team's per-tenant detail page (see getBillingSummaryForPlatform
// just below, which is deliberately org-wide). Joins clients only to
// apply the optional location filter — every billing_lines row has one
// (ON DELETE CASCADE from clients), so with locationId left null this
// returns exactly the same totals the org-wide version always has.
export async function getBillingSummary(organizationId, locationId = null) {
  requireOrgId(organizationId);
  const row = await queryOne(
    `SELECT
       COUNT(*) AS total_line_count,
       COUNT(*) FILTER (WHERE bl.status = 'pending') AS pending_line_count,
       COUNT(*) FILTER (WHERE sa.rate_per_unit IS NULL) AS unrated_line_count,
       COALESCE(
         SUM(bl.units * sa.rate_per_unit) FILTER (WHERE bl.status = 'pending' AND sa.rate_per_unit IS NOT NULL),
         0
       ) AS pending_amount,
       COALESCE(
         SUM(bl.units * sa.rate_per_unit) FILTER (WHERE bl.status = 'paid' AND sa.rate_per_unit IS NOT NULL),
         0
       ) AS paid_amount
     FROM billing_lines bl
     JOIN clients c ON c.id = bl.client_id
     LEFT JOIN service_authorizations sa ON sa.id = bl.service_authorization_id
     WHERE bl.organization_id = $1 AND ($2::text IS NULL OR c.location_id = $2)`,
    [organizationId, locationId]
  );
  return {
    totalLineCount: Number(row?.total_line_count || 0),
    pendingLineCount: Number(row?.pending_line_count || 0),
    unratedLineCount: Number(row?.unrated_line_count || 0),
    pendingAmount: Number(row?.pending_amount || 0),
    paidAmount: Number(row?.paid_amount || 0),
  };
}

// Org-wide billing snapshot for the platform's per-tenant detail page
// (app/platform/organizations/[id]/page.js) — deliberately NOT scoped to
// locations the way getLocationRevenueSummary is, so a tenant with
// clients that have no location_id ("agency direct" — see
// deferred-backlog.md's locations entry on that still-open gap) is not
// silently left out of the total the way it would be if this just summed
// getLocationRevenueSummary's rows. A thin wrapper over getBillingSummary
// with locationId pinned to null, kept as its own named export since
// "always org-wide, on purpose" is a real API contract for platform code
// to depend on, not just a default parameter value.
export async function getBillingSummaryForPlatform(organizationId) {
  return getBillingSummary(organizationId, null);
}

export async function getVisitsForClient(organizationId, clientId, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT v.* FROM visits v
     JOIN clients c ON c.id = v.client_id
     WHERE v.organization_id = $1 AND v.client_id = $2 AND ($3::text IS NULL OR c.location_id = $3)
     ORDER BY v.service_date, v.start_time`,
    [organizationId, clientId, locationId]
  );
  return rows.map(mapVisit);
}

export async function getOrientationsForClient(organizationId, clientId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT o.*, cg.name AS caregiver_name FROM caregiver_orientations o
     JOIN caregivers cg ON cg.id = o.caregiver_id
     WHERE o.organization_id = $1 AND o.client_id = $2
     ORDER BY o.created_at DESC`,
    [organizationId, clientId]
  );
  return rows.map(mapOrientation);
}

export async function getOrientation(organizationId, id) {
  requireOrgId(organizationId);
  const row = await queryOne(
    `SELECT o.*, cg.name AS caregiver_name, c.name AS client_name
     FROM caregiver_orientations o
     JOIN caregivers cg ON cg.id = o.caregiver_id
     JOIN clients c ON c.id = o.client_id
     WHERE o.organization_id = $1 AND o.id = $2`,
    [organizationId, id]
  );
  return mapOrientation(row);
}

export async function createOrientation(organizationId, data) {
  requireOrgId(organizationId);
  const id = randomUUID();
  await query(
    `INSERT INTO caregiver_orientations (id, organization_id, caregiver_id, client_id, orientation_type)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, organizationId, data.caregiverId, data.clientId, data.orientationType || 'initial']
  );
  return id;
}

export async function completeOrientation(organizationId, orientationId, data) {
  requireOrgId(organizationId);
  await query(
    `UPDATE caregiver_orientations
     SET method = $1, oriented_on = $2, agency_rep_name = $3, notes = $4, status = 'completed'
     WHERE organization_id = $5 AND id = $6`,
    [
      data.method || null,
      data.orientedOn || null,
      data.agencyRepName || null,
      data.notes || null,
      organizationId,
      orientationId,
    ]
  );
}

// The DocuSign path for the Attendant Orientation, kept separate from
// completeOrientation() above (the manual/paper path, unchanged). Sending
// records the same fields plus the envelope id, but leaves status='draft'
// — it only becomes 'completed' once the signature is actually confirmed,
// via confirmOrientationSigned(). Only reachable when
// organization_docusign_credentials.baa_on_file = true — enforced in
// actions/docusign.js, since this document carries client PHI.
export async function sendOrientationForSignature(organizationId, orientationId, data) {
  requireOrgId(organizationId);
  await query(
    `UPDATE caregiver_orientations
     SET method = $1, oriented_on = $2, agency_rep_name = $3, notes = $4,
         signed_via = 'docusign', envelope_id = $5
     WHERE organization_id = $6 AND id = $7`,
    [
      data.method || null,
      data.orientedOn || null,
      data.agencyRepName || null,
      data.notes || null,
      data.envelopeId,
      organizationId,
      orientationId,
    ]
  );
}

export async function confirmOrientationSigned(organizationId, orientationId) {
  requireOrgId(organizationId);
  await query(
    `UPDATE caregiver_orientations SET status = 'completed' WHERE organization_id = $1 AND id = $2`,
    [organizationId, orientationId]
  );
}


// --- accounts, sign-in and session checks (2026-09-23 access-control pass) ---
//
// These are the only functions that read `users` without an organization
// filter, because sign-in happens before we know the organization. Each
// one is careful to return nothing that crosses tenants: authenticateLogin
// returns just the one account whose password matched, and
// getSessionAccountState re-checks that the account still belongs to the
// organization its session token claims.

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';
const LOCKED_LOGIN_ERROR = `Too many failed sign-in attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes, or ask your agency administrator to reset your password.`;

// Compared against when the email has no account, so a wrong email takes
// the same time as a wrong password and response timing doesn't reveal
// which emails exist.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('hearth-no-such-account', 10);
  return dummyHashPromise;
}

async function recordLoginFailure(email, now) {
  const row = await queryOne(
    `INSERT INTO login_attempts (email, failed_count, last_failed_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (email) DO UPDATE
       SET failed_count = CASE
             WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= $2 THEN 1
             ELSE login_attempts.failed_count + 1
           END,
           locked_until = CASE
             WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= $2 THEN NULL
             ELSE login_attempts.locked_until
           END,
           last_failed_at = $2
     RETURNING failed_count`,
    [email, now]
  );
  if (row.failed_count >= LOGIN_MAX_FAILURES) {
    await query(
      `UPDATE login_attempts SET locked_until = $2 WHERE email = $1`,
      [email, new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000)]
    );
    return true;
  }
  return false;
}

export async function clearLoginFailures(email) {
  await query('DELETE FROM login_attempts WHERE email = $1', [String(email || '').trim().toLowerCase()]);
}

export async function getLoginLock(email, now = new Date()) {
  const row = await queryOne('SELECT locked_until FROM login_attempts WHERE email = $1', [
    String(email || '').trim().toLowerCase(),
  ]);
  return row?.locked_until && new Date(row.locked_until) > now ? new Date(row.locked_until) : null;
}

// Checks a sign-in. Returns { ok: true, kind: 'user', user } or
// { ok: true, kind: 'platform', admin } on success, { ok: false, error }
// otherwise. The error is deliberately the same for "no such email" and
// "wrong password". Only after the password is proven correct does it say
// WHY a real account can't sign in (deactivated, agency suspended) — at
// that point the person has already shown they own the account.
export async function authenticateLogin(emailRaw, password, now = new Date()) {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!email || !password) return { ok: false, error: 'Enter both an email and a password.' };

  if (await getLoginLock(email, now)) return { ok: false, error: LOCKED_LOGIN_ERROR };

  const user = await queryOne(
    `SELECT u.*, o.status AS org_status, c.status AS caregiver_status
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN caregivers c ON c.id = u.caregiver_id AND c.organization_id = u.organization_id
      WHERE u.email = $1`,
    [email]
  );
  const platform = user ? null : await queryOne('SELECT * FROM platform_admins WHERE email = $1', [email]);
  const hash = user?.password_hash || platform?.password_hash || (await dummyHash());
  const valid = await bcrypt.compare(String(password), hash);

  if (!valid || (!user && !platform)) {
    const lockedNow = await recordLoginFailure(email, now);
    if (lockedNow && user) {
      await logAuditEvent(user.organization_id, {
        actorUserId: user.id,
        actorName: user.name,
        actorRole: user.role,
        locationId: user.location_id,
        action: 'account_locked',
        entityType: 'user',
        entityId: user.id,
        detail: `${LOGIN_MAX_FAILURES} failed sign-in attempts; locked for ${LOGIN_LOCK_MINUTES} minutes`,
      });
    }
    return { ok: false, error: lockedNow ? LOCKED_LOGIN_ERROR : GENERIC_LOGIN_ERROR };
  }

  await clearLoginFailures(email);

  if (platform) {
    if (!platform.active) return { ok: false, error: 'This platform admin account has been deactivated.' };
    return { ok: true, kind: 'platform', admin: mapPlatformAdmin(platform) };
  }

  if (user.active === false || user.caregiver_status === 'inactive') {
    return { ok: false, error: 'This account has been deactivated. Contact your agency administrator.' };
  }
  if (user.org_status === 'suspended') {
    return { ok: false, error: "Your agency's Hearth access is suspended. Contact your Hearth representative." };
  }

  await query('UPDATE users SET last_login_at = $2 WHERE id = $1', [user.id, now]);
  return {
    ok: true,
    kind: 'user',
    user: {
      id: user.id,
      organizationId: user.organization_id,
      email: user.email,
      name: user.name,
      role: user.role,
      caregiverId: user.caregiver_id,
      locationId: user.location_id,
      sessionVersion: user.session_version ?? 1,
      mustChangePassword: Boolean(user.must_change_password),
    },
  };
}

// Called by lib/auth.js getSession() on EVERY request with the decoded
// session token. Returns null if the session must no longer be honoured,
// otherwise the fields that should be read fresh from the database rather
// than trusted from a token that may be days old.
export async function getSessionAccountState(payload) {
  if (!payload?.userId) return null;
  if (payload.role === 'PLATFORM_ADMIN') {
    const row = await queryOne('SELECT active, platform_role, name FROM platform_admins WHERE id = $1', [payload.userId]);
    if (!row || !row.active) return null;
    return { name: row.name, platformRole: row.platform_role };
  }
  const row = await queryOne(
    `SELECT u.organization_id, u.active, u.session_version, u.must_change_password, u.role,
            u.location_id, u.name, u.caregiver_id, o.status AS org_status, c.status AS caregiver_status
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN caregivers c ON c.id = u.caregiver_id AND c.organization_id = u.organization_id
      WHERE u.id = $1`,
    [payload.userId]
  );
  if (!row) return null;
  if (row.organization_id !== payload.organizationId) return null;
  if (row.active === false) return null;
  if ((row.session_version ?? 1) !== payload.sv) return null;
  if (row.org_status === 'suspended') return null;
  if (row.caregiver_status === 'inactive') return null;
  return {
    name: row.name,
    role: row.role,
    locationId: row.location_id,
    caregiverId: row.caregiver_id,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function getOrgUser(organizationId, userId) {
  requireOrgId(organizationId);
  return mapOrgUser(
    await queryOne(
      `SELECT u.*, loc.name AS location_name FROM users u
         LEFT JOIN locations loc ON loc.id = u.location_id
        WHERE u.organization_id = $1 AND u.id = $2`,
      [organizationId, userId]
    )
  );
}

async function countOtherActiveAdmins(organizationId, excludingUserId) {
  const row = await queryOne(
    `SELECT count(*)::int AS n FROM users
      WHERE organization_id = $1 AND role = 'ADMIN' AND active = true AND id <> $2`,
    [organizationId, excludingUserId]
  );
  return row.n;
}

// Office staff only (ADMIN / LOCATION_ADMIN / COORDINATOR). Caregiver
// logins follow the caregiver's HR status instead — see getSessionAccountState.
async function requireManageableStaff(organizationId, actorUserId, userId) {
  const target = await getOrgUser(organizationId, userId);
  if (!target) throw new Error('Account not found.');
  if (target.role === 'CAREGIVER') {
    throw new Error("Caregiver logins follow the caregiver's status — change it on the Caregivers page.");
  }
  if (target.id === actorUserId) {
    throw new Error("You can't change your own access. Ask another organization admin.");
  }
  return target;
}

// Deactivate / reactivate an office account. Deactivating bumps
// session_version so the person is signed out on their very next request.
export async function setOrgUserActive(organizationId, actorUserId, userId, active) {
  requireOrgId(organizationId);
  const target = await requireManageableStaff(organizationId, actorUserId, userId);
  if (!active && target.role === 'ADMIN' && (await countOtherActiveAdmins(organizationId, userId)) === 0) {
    throw new Error('This is the last active organization admin — add or reactivate another admin first.');
  }
  if (target.active === Boolean(active)) return false;
  await query(
    `UPDATE users
        SET active = $3,
            deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END,
            session_version = session_version + CASE WHEN $3 THEN 0 ELSE 1 END
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, userId, Boolean(active)]
  );
  return true;
}

// Change an office account's role and/or location. Same role/location
// contract as createOrgUser. Bumps session_version: the person signs in
// again and gets a session that matches their new access.
export async function updateOrgUserAccess(organizationId, actorUserId, userId, { role, locationId }) {
  requireOrgId(organizationId);
  const target = await requireManageableStaff(organizationId, actorUserId, userId);
  if (!['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR'].includes(role)) throw new Error('Pick a valid role.');
  const loc = locationId || null;
  if (role === 'LOCATION_ADMIN' && !loc) throw new Error('A location admin must be assigned to a location.');
  if (role === 'ADMIN' && loc) throw new Error('An organization admin is organization-wide and cannot be scoped to a location.');
  if (loc) {
    const location = await getLocation(organizationId, loc);
    if (!location) throw new Error('Location not found.');
  }
  if (target.role === 'ADMIN' && role !== 'ADMIN' && target.active
      && (await countOtherActiveAdmins(organizationId, userId)) === 0) {
    throw new Error('This is the last active organization admin — make someone else an admin first.');
  }
  if (target.role === role && (target.locationId || null) === loc) return false;
  await query(
    `UPDATE users SET role = $3, location_id = $4, session_version = session_version + 1
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, userId, role, loc]
  );
  return true;
}

// Admin-initiated password reset for an office account. The caller
// generates the temporary password (lib/passwords.js) and shows it once.
export async function resetOrgUserPassword(organizationId, actorUserId, userId, passwordHash) {
  requireOrgId(organizationId);
  const target = await requireManageableStaff(organizationId, actorUserId, userId);
  await setPasswordHash(organizationId, target.id, passwordHash, { mustChange: true });
  await clearLoginFailures(target.email);
  return target;
}

// Same for a caregiver's login, from the caregiver's page. Location-scoped
// callers can only reset caregivers in their own location.
export async function resetCaregiverLoginPassword(organizationId, caregiverId, passwordHash, locationId = null) {
  requireOrgId(organizationId);
  const caregiver = await getCaregiver(organizationId, caregiverId, locationId);
  if (!caregiver) throw new Error('Caregiver not found.');
  const login = await queryOne(
    'SELECT id, email FROM users WHERE organization_id = $1 AND caregiver_id = $2',
    [organizationId, caregiverId]
  );
  if (!login) throw new Error('This caregiver has no Hearth login yet.');
  await setPasswordHash(organizationId, login.id, passwordHash, { mustChange: true });
  await clearLoginFailures(login.email);
  return { userId: login.id, email: login.email, caregiverName: caregiver.name };
}

async function setPasswordHash(organizationId, userId, passwordHash, { mustChange }) {
  await query(
    `UPDATE users
        SET password_hash = $3, must_change_password = $4, password_changed_at = now(),
            session_version = session_version + 1
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, userId, passwordHash, Boolean(mustChange)]
  );
}

// The signed-in person changing their own password (the change-password
// page, forced after a reset or on first sign-in). Returns the new
// session_version so the caller can re-issue the current session cookie —
// every OTHER session for this account is signed out.
export async function changeOwnPassword(organizationId, userId, currentPassword, newPasswordHash, newPassword) {
  requireOrgId(organizationId);
  const row = await queryOne('SELECT password_hash FROM users WHERE organization_id = $1 AND id = $2', [organizationId, userId]);
  if (!row) throw new Error('Account not found.');
  if (!(await bcrypt.compare(String(currentPassword || ''), row.password_hash))) {
    throw new Error('Your current password is incorrect.');
  }
  if (await bcrypt.compare(String(newPassword || ''), row.password_hash)) {
    throw new Error('Choose a password different from your current one.');
  }
  await setPasswordHash(organizationId, userId, newPasswordHash, { mustChange: false });
  const updated = await queryOne('SELECT session_version FROM users WHERE id = $1', [userId]);
  return updated.session_version;
}


// --- visit maintenance (2026-09-23) ----------------------------------------
//
// The audited replacement for "Mark reviewed" and "Submit VMUR". Modeled on
// Vesta's 3-step flow (contact -> document -> verify) and HHSC's rules:
//   - EVV Policy Handbook §9050 (Rev. 25-1): maintenance must be finished
//     within 95 calendar days of the date of service; after that the visit
//     locks and only a payer-approved Visit Maintenance Unlock Request
//     (VMUR) reopens it.
//   - §9000: recorded clock in/out times, hours worked and GPS can't be
//     changed. So a time can only be ENTERED where none was captured.
//   - §10000: a reason code is required for every maintenance; free text
//     is required for 210 I (Emergency) and 600 (Other); several codes may
//     be used on one visit.

const MAINTENANCE_CONTACTS = ['none', 'client', 'caregiver', 'substitute'];
const MAX_REASON_CODES = 3;

// The effective maintenance window for an agency: its own shorter deadline
// if it set one, otherwise its state's. Never longer than the state's.
export function getMaintenanceWindowDays(organization) {
  const stateDays = getComplianceProfile(organization?.state)?.visitMaintenanceWindowDays ?? 95;
  const own = organization?.visitMaintenanceWindowDays;
  return own ? Math.min(own, stateDays) : stateDays;
}

// { windowDays, daysSinceService, daysRemaining, locked } for one visit.
export function getMaintenanceStatus(organization, visit, now = new Date()) {
  const windowDays = getMaintenanceWindowDays(organization);
  if (!visit?.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(visit.serviceDate)) {
    return { windowDays, daysSinceService: null, daysRemaining: null, locked: false };
  }
  const daysSinceService = daysBetween(visit.serviceDate, todayIso(now));
  const daysRemaining = windowDays - daysSinceService;
  return { windowDays, daysSinceService, daysRemaining, locked: daysRemaining < 0 };
}

// "14:05" (what <input type="time"> submits) -> "2:05 PM" (Hearth's label).
function hhmmToLabel(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function mapMaintenance(row) {
  return {
    id: row.id,
    visitId: row.visit_id,
    kind: row.kind,
    contact: row.contact,
    reasonCodes: row.reason_codes || [],
    note: row.note,
    manualClockInAt: row.manual_clock_in_at,
    manualClockOutAt: row.manual_clock_out_at,
    payerReference: row.payer_reference,
    billMinutesBefore: row.bill_minutes_before ?? null,
    billMinutesAfter: row.bill_minutes_after ?? null,
    performedByName: row.performed_by_name,
    performedByRole: row.performed_by_role,
    createdAt: row.created_at,
  };
}

export async function getVisitMaintenanceHistory(organizationId, visitId) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT * FROM visit_maintenance WHERE organization_id = $1 AND visit_id = $2 ORDER BY created_at DESC, id`,
    [organizationId, visitId]
  );
  return rows.map(mapMaintenance);
}

// Validates and applies one visit-maintenance entry. `actor` is
// { userId, name, role, locationId } from the session. Returns
// { maintenanceId, completedNow }. Throws a staff-readable Error on any
// rule violation, having changed nothing.
export async function performVisitMaintenance(organizationId, visitId, data, actor, now = new Date()) {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId, actor?.locationId || null);
  if (!visit) throw new Error('Visit not found.');
  const organization = await getOrganization(organizationId);
  const profile = getComplianceProfile(organization?.state);
  if (!profile) throw new Error("Visit maintenance isn't configured for this agency's state yet.");

  const status = getMaintenanceStatus(organization, visit, now);
  if (status.locked) {
    throw new Error(
      `This visit is past the ${status.windowDays}-day maintenance window and is locked. Record a Visit Maintenance Unlock Request (VMUR) to the payer instead.`
    );
  }
  if (visit.status === 'scheduled' && visit.serviceDate > todayIso(now)) {
    throw new Error("This visit hasn't happened yet.");
  }

  // Step 1 — contact
  const contact = String(data.contact || '');
  if (!MAINTENANCE_CONTACTS.includes(contact)) {
    throw new Error('Say who you contacted to confirm the visit (or "no contact needed").');
  }

  // Step 2 — document
  const codes = [...new Set((data.reasonCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) throw new Error('Choose at least one reason code.');
  if (codes.length > MAX_REASON_CODES) throw new Error(`Choose at most ${MAX_REASON_CODES} reason codes.`);
  const infos = codes.map((code) => {
    const info = profile.reasonCodes?.[code];
    if (!info || info.selectable === false) throw new Error(`"${code}" isn't a reason code you can select.`);
    return info;
  });
  const note = String(data.note || '').trim() || null;
  if (note && note.length > 1000) throw new Error('Keep the note under 1,000 characters.');
  const needsNote = codes.filter((c, i) => infos[i].requiresNote);
  if (needsNote.length > 0 && !note) {
    throw new Error(`Reason code ${needsNote.map((c) => `${c.slice(0, 3)} ${c.slice(3)}`.trim()).join(', ')} requires a note.`);
  }

  const inLabel = data.manualClockIn ? hhmmToLabel(data.manualClockIn) : null;
  const outLabel = data.manualClockOut ? hhmmToLabel(data.manualClockOut) : null;
  if (data.manualClockIn && !inLabel) throw new Error('Enter the clock-in time as HH:MM.');
  if (data.manualClockOut && !outLabel) throw new Error('Enter the clock-out time as HH:MM.');
  const hasIn = Boolean(visit.evv?.clockInAt || visit.evv?.clockIn);
  const hasOut = Boolean(visit.evv?.clockOutAt || visit.evv?.clockOut);
  if (inLabel && hasIn) throw new Error("A clock-in time was already recorded, and HHSC doesn't allow recorded clock times to be changed.");
  if (outLabel && hasOut) throw new Error("A clock-out time was already recorded, and HHSC doesn't allow recorded clock times to be changed.");
  if ((inLabel || outLabel) && !infos.some((i) => i.allowsManualTime)) {
    throw new Error('Entering a missing clock time needs a 210 reason code (No Electronic Clock In or Clock Out).');
  }
  if (visit.status !== 'missed') {
    if (!hasIn && !inLabel) throw new Error('This visit has no clock-in. Enter the time services started.');
    if (!hasOut && !outLabel) throw new Error('This visit has no clock-out. Enter the time services ended.');
  }
  const inAt = inLabel ? new Date(toUtcIso(visit.serviceDate, inLabel) + 'Z') : null;
  const outAt = outLabel ? new Date(toUtcIso(visit.serviceDate, outLabel) + 'Z') : null;
  const effectiveIn = inAt || (visit.evv?.clockInAt ? new Date(visit.evv.clockInAt) : null);
  const effectiveOut = outAt || (visit.evv?.clockOutAt ? new Date(visit.evv.clockOutAt) : null);
  if (effectiveIn && effectiveOut && effectiveOut <= effectiveIn) {
    throw new Error('The clock-out must be after the clock-in. An overnight visit has to be split at midnight into two visits.');
  }
  if ((inAt && inAt > now) || (outAt && outAt > now)) throw new Error("A clock time can't be in the future.");

  // 110 B — downward adjustment of bill hours. The new figure is required
  // with 110 B, only allowed with it, and can only go down.
  const billFieldsGiven = String(data.billHours ?? '').trim() !== '' || String(data.billMinutes ?? '').trim() !== '';
  let billBefore = null;
  let billAfter = null;
  if (codes.includes('110B') || billFieldsGiven) {
    if (!codes.includes('110B')) throw new Error('Changing billable time needs reason code 110 B (downward adjustment of bill hours).');
    const h = String(data.billHours ?? '').trim() === '' ? 0 : Number(data.billHours);
    const m = String(data.billMinutes ?? '').trim() === '' ? 0 : Number(data.billMinutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) {
      throw new Error('Enter billable time as whole hours and minutes (0-59).');
    }
    billBefore = billableMinutes(visit);
    billAfter = h * 60 + m;
    if (billAfter <= 0) throw new Error('Billable time must be more than zero. A visit with no billable time is a missed visit.');
    if (!billBefore) throw new Error("This visit's billable time can't be worked out, so it can't be adjusted.");
    if (billAfter >= billBefore) {
      throw new Error(`110 B only lowers billable time — it must be less than the current ${Math.floor(billBefore / 60)}h ${billBefore % 60}m.`);
    }
  }

  // Step 3 — verify
  if (data.verified !== true) {
    throw new Error('Confirm that you verified the services were delivered as documented.');
  }

  const maintenanceId = randomUUID();
  const completedNow = Boolean(outAt) && visit.status !== 'completed';
  let method = visit.evv?.method || null;
  if (inAt && outAt) method = 'Manual entry (visit maintenance)';
  else if (outAt) method = `${method || 'Mobile check-in'}; manual clock-out (visit maintenance)`;
  else if (inAt) method = `Manual clock-in (visit maintenance); ${method || 'mobile check-out'}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO visit_maintenance
         (id, organization_id, visit_id, kind, contact, reason_codes, note, manual_clock_in_at, manual_clock_out_at,
          performed_by_user_id, performed_by_name, performed_by_role, created_at, bill_minutes_before, bill_minutes_after)
       VALUES ($1,$2,$3,'maintenance',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [maintenanceId, organizationId, visitId, contact, codes, note, inAt, outAt,
        actor?.userId || null, actor?.name || 'Unknown', actor?.role || 'UNKNOWN', now, billBefore, billAfter]
    );
    await client.query(
      `UPDATE visits
          SET resolved = true,
              evv_verified = true,
              evv_exception = $3,
              evv_note = COALESCE($4, evv_note),
              evv_method = $5,
              evv_clock_in = COALESCE(evv_clock_in, $6),
              evv_clock_in_at = COALESCE(evv_clock_in_at, $7),
              evv_clock_out = COALESCE(evv_clock_out, $8),
              evv_clock_out_at = COALESCE(evv_clock_out_at, $9),
              status = CASE WHEN $10::boolean THEN 'completed' ELSE status END,
              bill_minutes = COALESCE($11, bill_minutes)
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, visitId, codes[0], note, method, inLabel, inAt, outLabel, outAt, completedNow, billAfter]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await logAuditEvent(organizationId, {
    actorUserId: actor?.userId,
    actorName: actor?.name || 'Unknown',
    actorRole: actor?.role || 'UNKNOWN',
    locationId: actor?.locationId,
    action: 'visit_maintenance',
    entityType: 'visit',
    entityId: visitId,
    detail: `codes ${codes.join(', ')}; contacted ${contact}${inAt || outAt ? '; entered missing clock time' : ''}${
      billAfter ? `; bill time ${billBefore} -> ${billAfter} min` : ''
    }`,
  });

  // A 110 B adjustment flows into billing: a line not yet sent to the payer
  // is recalculated; one already submitted/paid/denied is left alone and
  // the caller is told to correct it with the payer.
  let billing = null;
  if (billAfter) {
    const line = await queryOne(
      'SELECT id, status FROM billing_lines WHERE organization_id = $1 AND visit_id = $2',
      [organizationId, visitId]
    );
    if (line) {
      if (['pending', 'ready'].includes(line.status)) {
        const ctx = await loadVisitExportContext(organizationId, visitId);
        const unitMinutes = ctx?.authorization?.unitMinutes || 15;
        const units = Math.max(1, Math.round(billAfter / unitMinutes));
        await query(
          `UPDATE billing_lines SET units = $3,
                  notes = trim(both ' ' from coalesce(notes, '') || ' ' || $4)
            WHERE organization_id = $1 AND id = $2`,
          [organizationId, line.id, units, `[110 B ${todayIso(now)}: ${billBefore} -> ${billAfter} min]`]
        );
        billing = { updated: true, units, status: line.status };
      } else {
        billing = { updated: false, status: line.status };
      }
    }
  }

  try {
    await enqueueEvvSync(organizationId, visitId, 'visit_update');
  } catch (err) {
    console.error('enqueueEvvSync (visit maintenance) failed for visit', visitId, err);
  }
  if (completedNow) {
    const evvCredentials = await getEvvCredentials(organizationId);
    if (evvCredentials?.status !== 'live') {
      try {
        await generateBillingLineForVisit(organizationId, visitId);
      } catch (err) {
        console.error('generateBillingLineForVisit (visit maintenance) failed for visit', visitId, err);
      }
    }
  }
  return { maintenanceId, completedNow, billing };
}

// Past the window: records that a Visit Maintenance Unlock Request went to
// the payer, and why. Hearth doesn't send the VMUR itself (it goes through
// the payer's own process); this is the agency's record of it.
export async function recordVisitVmur(organizationId, visitId, data, actor, now = new Date()) {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId, actor?.locationId || null);
  if (!visit) throw new Error('Visit not found.');
  const organization = await getOrganization(organizationId);
  const status = getMaintenanceStatus(organization, visit, now);
  if (!status.locked) {
    throw new Error(`This visit is still inside the ${status.windowDays}-day window — correct it with visit maintenance instead of a VMUR.`);
  }
  const justification = String(data.justification || '').trim();
  if (justification.length < 10) throw new Error('Explain why the visit needs to be unlocked (at least a sentence).');
  if (justification.length > 1000) throw new Error('Keep the justification under 1,000 characters.');
  const payerReference = String(data.payerReference || '').trim() || null;
  if (payerReference && payerReference.length > 100) throw new Error('Keep the payer reference under 100 characters.');

  const id = randomUUID();
  await query(
    `INSERT INTO visit_maintenance
       (id, organization_id, visit_id, kind, note, payer_reference, performed_by_user_id, performed_by_name, performed_by_role, created_at)
     VALUES ($1,$2,$3,'vmur',$4,$5,$6,$7,$8,$9)`,
    [id, organizationId, visitId, justification, payerReference,
      actor?.userId || null, actor?.name || 'Unknown', actor?.role || 'UNKNOWN', now]
  );
  await query(
    'UPDATE visits SET vmur_submitted = true WHERE organization_id = $1 AND id = $2',
    [organizationId, visitId]
  );
  await logAuditEvent(organizationId, {
    actorUserId: actor?.userId,
    actorName: actor?.name || 'Unknown',
    actorRole: actor?.role || 'UNKNOWN',
    locationId: actor?.locationId,
    action: 'visit_vmur_recorded',
    entityType: 'visit',
    entityId: visitId,
    detail: payerReference ? `payer reference ${payerReference}` : 'no payer reference yet',
  });
  return id;
}

// Settings page: flexible hours + the agency's own maintenance deadline.
export async function updateOrganizationEvvSettings(organizationId, { flexibleHoursEnabled, graceMinutes, maintenanceWindowDays, homeRadiusFeet }) {
  requireOrgId(organizationId);
  const organization = await getOrganization(organizationId);
  if (!organization) throw new Error('Organization not found.');
  const stateDays = getComplianceProfile(organization.state)?.visitMaintenanceWindowDays ?? null;
  let days = null;
  if (maintenanceWindowDays !== null && maintenanceWindowDays !== undefined && String(maintenanceWindowDays).trim() !== '') {
    days = Number(maintenanceWindowDays);
    if (!Number.isInteger(days) || days < 1) throw new Error('The maintenance deadline must be a whole number of days.');
    if (stateDays && days > stateDays) {
      throw new Error(`The maintenance deadline can't be longer than the state's ${stateDays} days.`);
    }
    if (stateDays && days === stateDays) days = null;
  }
  let radius = organization.homeRadiusFeet ?? DEFAULT_HOME_RADIUS_FEET;
  if (homeRadiusFeet !== undefined && homeRadiusFeet !== null && String(homeRadiusFeet).trim() !== '') {
    radius = Number(homeRadiusFeet);
    if (!Number.isInteger(radius) || radius < 50 || radius > 2000) {
      throw new Error('The "at home" radius must be a whole number of feet between 50 and 2,000.');
    }
  }
  await updateOrganizationFlexibleHours(organizationId, { enabled: flexibleHoursEnabled, graceMinutes });
  await query('UPDATE organizations SET visit_maintenance_window_days = $2, home_radius_feet = $3 WHERE id = $1', [organizationId, days, radius]);
}


// --- client home location (2026-09-24) -------------------------------------

async function writeClientHome(organizationId, clientId, lat, lng, source, setBy) {
  await query(
    `UPDATE clients SET home_lat = $3, home_lng = $4, home_location_source = $5,
            home_location_set_at = now(), home_location_set_by = $6
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, clientId, lat, lng, source, setBy]
  );
}

// Staff enter the home location directly (e.g. pasted from a map).
export async function setClientHomeLocation(organizationId, clientId, { lat, lng }, actor, locationId = null) {
  requireOrgId(organizationId);
  const client = await getClient(organizationId, clientId, locationId);
  if (!client) throw new Error('Client not found.');
  const la = Number(lat);
  const ln = Number(lng);
  if (!isValidLatLng(la, ln)) throw new Error('Enter a valid latitude and longitude, e.g. 26.075175, -97.473486.');
  await writeClientHome(organizationId, clientId, la, ln, 'entered', actor?.name || 'Unknown');
  return client;
}

// Staff take the home location from one visit's recorded clock-in or
// clock-out GPS fix (Vesta's "Learned Location" adjustment).
export async function setClientHomeFromVisit(organizationId, visitId, which, actor, locationId = null) {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId, locationId);
  if (!visit) throw new Error('Visit not found.');
  const lat = which === 'out' ? visit.evv?.clockOutLat : visit.evv?.clockInLat;
  const lng = which === 'out' ? visit.evv?.clockOutLng : visit.evv?.clockInLng;
  if (!isValidLatLng(lat, lng)) throw new Error('That clock event has no GPS location to use.');
  await writeClientHome(organizationId, visit.clientId, lat, lng, 'from_visit', `${actor?.name || 'Unknown'} (visit ${visitId}, clock-${which === 'out' ? 'out' : 'in'})`);
  return visit.clientId;
}

export async function clearClientHomeLocation(organizationId, clientId, locationId = null) {
  requireOrgId(organizationId);
  const client = await getClient(organizationId, clientId, locationId);
  if (!client) throw new Error('Client not found.');
  await query(
    `UPDATE clients SET home_lat = NULL, home_lng = NULL, home_location_source = NULL,
            home_location_set_at = NULL, home_location_set_by = NULL
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, clientId]
  );
}


// --- EVV export status (2026-09-24) ----------------------------------------
//
// Visit-by-visit view of sending closed visits to the state aggregator —
// Vesta's Verified -> ON HOLD -> EXPORT -> EXPORTED flow, plus accepted /
// rejected, which Vesta's guide notes are separate from "exported".

// Everything the EVV payload for one visit needs. Uses the authorization
// picked when the visit was scheduled; falls back to the client's active
// authorization only for visits scheduled before that pick existed. (Until
// 2026-09-24 lib/evv-sync.js always used the active one, so a client with
// two authorizations could be sent with the wrong service code.)
export async function loadVisitExportContext(organizationId, visitId) {
  requireOrgId(organizationId);
  const visit = await getVisit(organizationId, visitId);
  if (!visit) return null;
  const [client, caregiver] = await Promise.all([
    getClient(organizationId, visit.clientId),
    getCaregiver(organizationId, visit.caregiverId),
  ]);
  let authorization = null;
  if (visit.serviceAuthorizationId) {
    authorization = mapAuthorization(
      await queryOne('SELECT * FROM service_authorizations WHERE organization_id = $1 AND id = $2', [
        organizationId,
        visit.serviceAuthorizationId,
      ])
    );
  }
  if (!authorization) authorization = await getActiveAuthorization(organizationId, visit.clientId);
  return { visit, client, caregiver, authorization };
}

// Closed visits (completed or missed) in a date range, each with the most
// recent sync row for it. Location-scoped like every other reader.
export async function getVisitExportRows(organizationId, { from, to }, locationId = null) {
  requireOrgId(organizationId);
  const rows = await query(
    `SELECT v.*, c.name AS client_name, cg.name AS caregiver_name,
            s.id AS sync_id, s.operation AS sync_operation, s.status AS sync_status,
            s.last_error AS sync_last_error, s.attempts AS sync_attempts, s.updated_at AS sync_updated_at
       FROM visits v
       JOIN clients c ON c.id = v.client_id AND c.organization_id = v.organization_id
       LEFT JOIN caregivers cg ON cg.id = v.caregiver_id AND cg.organization_id = v.organization_id
       LEFT JOIN LATERAL (
         SELECT * FROM evv_sync_log sl
          WHERE sl.organization_id = v.organization_id AND sl.visit_id = v.id
            AND sl.operation IN ('visit_create', 'visit_update')
          ORDER BY sl.created_at DESC, sl.id DESC
          LIMIT 1
       ) s ON true
      WHERE v.organization_id = $1
        AND v.status IN ('completed', 'missed')
        AND v.service_date >= $2 AND v.service_date <= $3
        AND ($4::text IS NULL OR c.location_id = $4)
      ORDER BY v.service_date DESC, v.start_time`,
    [organizationId, from, to, locationId]
  );
  return rows.map((row) => ({
    visit: mapVisit(row),
    clientName: row.client_name,
    caregiverName: row.caregiver_name,
    latestSync: row.sync_id
      ? {
          id: row.sync_id,
          operation: row.sync_operation,
          status: row.sync_status,
          lastError: row.sync_last_error,
          attempts: row.sync_attempts,
          updatedAt: row.sync_updated_at,
        }
      : null,
  }));
}

function auditExport(organizationId, actor, action, visitIds, detail) {
  return logAuditEvent(organizationId, {
    actorUserId: actor?.userId,
    actorName: actor?.name || 'Unknown',
    actorRole: actor?.role || 'UNKNOWN',
    locationId: actor?.locationId,
    action,
    entityType: 'visit',
    entityId: visitIds.length === 1 ? visitIds[0] : null,
    detail: `${visitIds.length} visit(s)${detail ? `; ${detail}` : ''}${visitIds.length > 1 ? `: ${visitIds.slice(0, 20).join(', ')}` : ''}`,
  });
}

// Put visits on hold (or release them). Returns the ids actually changed.
export async function setVisitsExportHold(organizationId, visitIds, hold, reason, actor, now = new Date()) {
  requireOrgId(organizationId);
  const ids = [...new Set((visitIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) throw new Error('Select at least one visit.');
  if (ids.length > 200) throw new Error('Select at most 200 visits at a time.');
  const why = String(reason || '').trim() || null;
  if (hold && !why) throw new Error('Say why the visit is being held (it shows to everyone who sees it).');
  if (why && why.length > 300) throw new Error('Keep the hold reason under 300 characters.');
  const changed = [];
  for (const id of ids) {
    const visit = await getVisit(organizationId, id, actor?.locationId || null);
    if (!visit) throw new Error('One of the selected visits was not found.');
    if (Boolean(visit.exportHold) === Boolean(hold)) continue;
    await query(
      `UPDATE visits SET evv_export_hold = $3, evv_export_hold_reason = $4, evv_export_hold_by = $5, evv_export_hold_at = $6
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, id, Boolean(hold), hold ? why : null, hold ? actor?.name || 'Unknown' : null, hold ? now : null]
    );
    changed.push(id);
  }
  if (changed.length > 0) {
    await auditExport(organizationId, actor, hold ? 'evv_export_hold' : 'evv_export_release', changed, hold ? `reason: ${why}` : '');
  }
  return changed;
}

// Queue visits that were never queued (or need re-sending after a
// correction). Skips, with a reason, anything that can't be sent yet.
export async function queueVisitsForExport(organizationId, visitIds, actor) {
  requireOrgId(organizationId);
  const ids = [...new Set((visitIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) throw new Error('Select at least one visit.');
  if (ids.length > 200) throw new Error('Select at most 200 visits at a time.');
  const queued = [];
  const skipped = [];
  for (const id of ids) {
    const visit = await getVisit(organizationId, id, actor?.locationId || null);
    if (!visit) throw new Error('One of the selected visits was not found.');
    if (!['completed', 'missed'].includes(visit.status)) { skipped.push({ id, reason: 'not finished yet' }); continue; }
    if (visit.evv?.exception && !visit.resolved) { skipped.push({ id, reason: 'open exception — needs visit maintenance' }); continue; }
    if (visit.exportHold) { skipped.push({ id, reason: 'on hold' }); continue; }
    const created = await queryOne(
      `SELECT 1 FROM evv_sync_log WHERE organization_id = $1 AND visit_id = $2 AND operation = 'visit_create'
         AND status IN ('sent', 'acknowledged') LIMIT 1`,
      [organizationId, id]
    );
    await enqueueEvvSync(organizationId, id, created ? 'visit_update' : 'visit_create');
    queued.push(id);
  }
  if (queued.length > 0) await auditExport(organizationId, actor, 'evv_export_queue', queued, '');
  return { queued, skipped };
}
