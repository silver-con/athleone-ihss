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
import { query, queryOne, pool } from '@/lib/db';

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
  };
}

function mapVisit(row) {
  if (!row) return null;
  const hasEvv = row.status !== 'scheduled' || row.evv_exception != null;
  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    clientId: row.client_id,
    day: row.day,
    serviceDate: row.service_date,
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    resolved: row.resolved,
    vmurSubmitted: row.vmur_submitted,
    evv: hasEvv
      ? {
          clockIn: row.evv_clock_in,
          clockOut: row.evv_clock_out,
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
    `INSERT INTO users (id, organization_id, email, password_hash, name, role, location_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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

    await client.query("UPDATE referrals SET status = 'completed' WHERE organization_id = $1 AND id = $2", [
      organizationId,
      referralId,
    ]);

    const authHours = formData.authHours || referral.authHours;
    const parsedHours = parseFloat(String(authHours).replace(/[^0-9.]/g, '')) || 0;
    const clientId = 'c-' + referralId;

    await client.query(
      `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date, address, emergency_contact, care_needs, assigned_caregiver_id, from_referral_id, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        clientId,
        organizationId,
        formData.clientName || referral.clientName,
        formData.payerName || referral.payer,
        authHours,
        parsedHours,
        new Date().toLocaleDateString('en-US'),
        [formData.address, formData.cityStateZip].filter(Boolean).join(', ') || null,
        formData.ecName ? `${formData.ecName}${formData.ecRelationship ? ` (${formData.ecRelationship})` : ''}${formData.ecPhone ? ` · ${formData.ecPhone}` : ''}` : null,
        JSON.stringify(formData.careNeeds || []),
        null,
        referralId,
        formData.locationId || null,
      ]
    );

    await client.query('COMMIT');
    return { clientName: referral.clientName };
  } catch (err) {
    await client.query('ROLLBACK');
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

export async function clockIn(organizationId, visitId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const visit = await getVisit(organizationId, visitId, locationId);
    if (!visit) throw new Error('Visit not found in this location.');
  }
  await query(
    `UPDATE visits SET status = 'in-progress', evv_clock_in = 'Just now', evv_clock_out = NULL,
       evv_method = 'GPS mobile check-in', evv_verified = false, evv_exception = NULL
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, visitId]
  );
}

export async function clockOut(organizationId, visitId, locationId = null) {
  requireOrgId(organizationId);
  if (locationId) {
    const existingVisit = await getVisit(organizationId, visitId, locationId);
    if (!existingVisit) throw new Error('Visit not found in this location.');
  }
  await query(
    `UPDATE visits SET status = 'completed', resolved = true, evv_clock_out = 'Just now', evv_verified = true
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, visitId]
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
        provider_tax_id, office_qualifier, office_identifier, payer_id, environment, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (organization_id) DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url, api_version = EXCLUDED.api_version,
       client_id_enc = EXCLUDED.client_id_enc, client_secret_enc = EXCLUDED.client_secret_enc,
       scope = EXCLUDED.scope, provider_tax_id = EXCLUDED.provider_tax_id,
       office_qualifier = EXCLUDED.office_qualifier, office_identifier = EXCLUDED.office_identifier,
       payer_id = EXCLUDED.payer_id, environment = EXCLUDED.environment, status = EXCLUDED.status`,
    [
      organizationId, data.apiBaseUrl, data.apiVersion || '1', data.clientIdEnc,
      data.clientSecretEnc, data.scope || null, data.providerTaxId || null,
      data.officeQualifier || 'NPI', data.officeIdentifier || null, data.payerId || null,
      data.environment || 'sandbox', data.status || 'testing',
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
    `SELECT * FROM evv_sync_log
     WHERE organization_id = $1 AND status = 'pending'
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at
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
      data.totalUnitsPerWeek ?? null,
      data.unitMinutes ?? 15,
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

  const auth = await getActiveAuthorization(organizationId, visit.clientId);
  const unitMinutes = auth?.unitMinutes || 15;
  const minutes = minutesBetween(visit.start, visit.end);
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
      `INSERT INTO users (id, organization_id, email, password_hash, name, role, caregiver_id, location_id)
       VALUES ($1,$2,$3,$4,$5,'CAREGIVER',$6,$7)`,
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
  const trainingDone =
    initialCourses.length > 0 && initialCourses.every((c) => doneIds.has(c.id));

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
    texasMedicaidProviderNumber: row.texas_medicaid_provider_number,
    npi: row.npi,
    hcssaLicenseNumber: row.hcssa_license_number,
    providerEnrollmentAttested: row.provider_enrollment_attested,
    baaSigned: row.baa_signed,
    baaSignedAt: row.baa_signed_at,
    status: row.status,
    createdAt: row.created_at,
  };
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
         (id, name, texas_medicaid_provider_number, npi, hcssa_license_number, status)
       VALUES ($1,$2,$3,$4,$5,'trial')`,
      [
        organizationId,
        data.organizationName,
        data.texasMedicaidProviderNumber || null,
        data.npi || null,
        data.hcssaLicenseNumber || null,
      ]
    );
    await client.query(
      `INSERT INTO users (id, organization_id, email, password_hash, name, role)
       VALUES ($1,$2,$3,$4,$5,'ADMIN')`,
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
    texas_medicaid_provider_number: patch.texasMedicaidProviderNumber,
    npi: patch.npi,
    hcssa_license_number: patch.hcssaLicenseNumber,
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
    row.texas_medicaid_provider_number && row.npi && row.hcssa_license_number
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
    status: row.status,
    createdAt: row.created_at,
    texasMedicaidProviderNumber: row.texas_medicaid_provider_number,
    npi: row.npi,
    hcssaLicenseNumber: row.hcssa_license_number,
    providerInfoDone,
    enrollmentDone,
    baaDone,
    evvStatus: row.evv_status, // null | not_started | testing | passed | live | disabled
    evvEnvironment: row.evv_environment,
    evvLastSuccessAt: row.evv_last_success_at,
    evvFailedCount: Number(row.evv_failed_count || 0),
    credentialsConfigured,
    certificationPassed,
    evvLive,
    onboardingStepsDone,
    onboardingStepsTotal: 7,
  };
}

export async function getAllOrganizationsForPlatform() {
  const rows = await query(
    `SELECT
       o.*,
       ec.status AS evv_status,
       ec.environment AS evv_environment,
       ec.last_success_at AS evv_last_success_at,
       COALESCE(fail.failed_count, 0) AS evv_failed_count
     FROM organizations o
     LEFT JOIN organization_evv_credentials ec ON ec.organization_id = o.id
     LEFT JOIN (
       SELECT organization_id, COUNT(*) AS failed_count
       FROM evv_sync_log
       WHERE status = 'failed'
       GROUP BY organization_id
     ) fail ON fail.organization_id = o.id
     ORDER BY o.created_at DESC`
  );
  return rows.map(mapOrganizationForPlatform);
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
