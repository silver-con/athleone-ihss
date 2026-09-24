// Seeds the Postgres database with the same sample data the prototype used
// to hold in memory (lib/data.js), plus one login (Users table) per role so
// you can sign in and try the app immediately after setup.
//
// Run with: npm run db:seed  (loads .env automatically via --env-file)
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../lib/db.js';
import {
  initialReferrals,
  initialClients,
  initialCaregivers,
  initialVisits,
  initialMessages,
  DEMO_TODAY_ISO,
} from '../lib/data.js';
import { todayIso, addDays, daysBetween, dayKeyForIso } from '../lib/calendar.js';

// Every demo visit date is shifted by the same number of days so the demo's
// "today" (DEMO_TODAY_ISO) lands on the real current date — see lib/data.js.
const DEMO_DATE_SHIFT = daysBetween(DEMO_TODAY_ISO, todayIso());
const shiftDemoDate = (iso) => (iso ? addDays(iso, DEMO_DATE_SHIFT) : iso);

// Multi-tenant: seeds the original demo agency (org-hearth-demo) with the
// full sample dataset, plus a second, minimal agency (org-second-demo) with
// just enough of its own data to prove tenant isolation actually works —
// see Task "Verify build + smoke test tenant isolation" in the project plan.
const ORG_PRIMARY = 'org-hearth-demo';
const ORG_SECONDARY = 'org-second-demo';

// Caregivers' own HR-record email (caregivers.email — distinct from the
// users table, which is their login). Kept the same as their login email
// for the demo so both look up the same address; matters for anything
// that emails the caregiver directly (e.g. DocuSign e-signature envelopes)
// rather than just authenticating them.
const CAREGIVER_EMAILS = {
  cg1: 'maria@hearth.demo',
  cg2: 'denise@hearth.demo',
  cg3: 'thomas@hearth.demo',
  cg4: 'priya@hearth.demo',
};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Clearing existing data…');
    // Deliberately NOT truncating `organizations` here (see
    // docs/TROUBLESHOOTING.md, 2026-09-17: "npm run db:seed silently wipes
    // DocuSign/EVV credentials"). organization_docusign_credentials and
    // organization_evv_credentials both have organization_id as a foreign
    // key to organizations with ON DELETE CASCADE — truncating
    // `organizations` cascades into wiping those too, even though neither
    // is named below, silently disconnecting DocuSign/EVV on every reseed.
    // Organizations are upserted instead (see below) so reseeding refreshes
    // demo data without nuking admin-entered per-tenant settings.
    await client.query(
      `TRUNCATE users, messages, billing_lines, service_authorizations, caregiver_orientations,
                training_completions, training_courses, caregiver_checks, caregiver_documents,
                visits, clients, referrals, caregivers RESTART IDENTITY CASCADE`
    );

    console.log('Seeding organizations…');
    await client.query(
      `INSERT INTO organizations (id, name, status) VALUES ($1, $2, 'active')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
      [ORG_PRIMARY, 'Hearth Home Care (Demo)']
    );
    await client.query(
      `INSERT INTO organizations (id, name, status) VALUES ($1, $2, 'trial')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
      [ORG_SECONDARY, 'Second Agency (Isolation Check)']
    );

    console.log('Seeding caregivers…');
    for (const cg of initialCaregivers) {
      await client.query(
        `INSERT INTO caregivers (id, organization_id, name, role, phone, email, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cg.id, ORG_PRIMARY, cg.name, cg.role, cg.phone, CAREGIVER_EMAILS[cg.id] || null, cg.status]
      );
    }

    console.log('Seeding referrals…');
    for (const r of initialReferrals) {
      await client.query(
        `INSERT INTO referrals (id, organization_id, payer, client_name, dob, service, auth_hours, auth_number, diagnosis, received_date, status, fax)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.id, ORG_PRIMARY, r.payer, r.clientName, r.dob, r.service, r.authHours, r.authNumber, r.diagnosis, r.receivedDate, r.status, r.fax ? JSON.stringify(r.fax) : null]
      );
    }

    console.log('Seeding clients…');
    for (const c of initialClients) {
      await client.query(
        `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date, address, emergency_contact, care_needs, assigned_caregiver_id, hhsc_individual_number,
                              medicaid_id, date_of_birth, address_line1, city, state, zip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [c.id, ORG_PRIMARY, c.name, c.payer, c.authHours, c.authHoursNum, c.intakeDate, c.address || null, c.emergencyContact || null, JSON.stringify(c.careNeeds || []), c.assignedCaregiverId || null, c.hhscIndividualNumber || null,
         c.medicaidId || null, c.dateOfBirth || null, c.addressLine1 || null, c.city || null, c.state || null, c.zip || null]
      );
    }

    console.log('Seeding visits…');
    for (const v of initialVisits) {
      await client.query(
        `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status, resolved, vmur_submitted, evv_clock_in, evv_clock_out, evv_method, evv_verified, evv_exception, evv_note, tasks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          v.id,
          ORG_PRIMARY,
          v.caregiverId,
          v.clientId,
          dayKeyForIso(shiftDemoDate(v.serviceDate)),
          shiftDemoDate(v.serviceDate),
          v.start,
          v.end,
          v.status,
          v.resolved,
          v.vmurSubmitted || false,
          v.evv?.clockIn || null,
          v.evv?.clockOut || null,
          v.evv?.method || null,
          v.evv?.verified || false,
          v.evv?.exception || null,
          v.evv?.note || null,
          JSON.stringify(v.tasks || []),
        ]
      );
    }

    console.log('Seeding messages…');
    for (const m of initialMessages) {
      await client.query(
        `INSERT INTO messages (id, organization_id, caregiver_id, sender, body, time, mine) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [m.id, ORG_PRIMARY, m.caregiverId, m.sender, m.text, m.time, m.mine]
      );
    }

    // Care Plan module demo data — modeled on the shape of a real MCO
    // "Authorization Notification" (payer, service code, unit count, date
    // range, purchased-tasks list), with fictional identifiers only. This
    // gives the Care Plan and Finance admin pages something real to show
    // out of the box, tied to client c1 (Walter Ibsen) who already has a
    // completed visit (v1) to generate a billing line from.
    console.log('Seeding a demo service authorization + billing line…');
    const authId = randomUUID();
    await client.query(
      `INSERT INTO service_authorizations
         (id, organization_id, client_id, payer, case_id, reference_number, service_code,
          service_description, modifier_codes, diagnosis_code, diagnosis_description,
          total_hours_per_week, total_units_per_week, unit_minutes, frequency,
          start_date, end_date, status, purchased_tasks, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        authId,
        ORG_PRIMARY,
        'c1',
        'Molina Healthcare',
        'LTSS-DEMO-0001',
        'PA-DEMO-0001',
        'S5125',
        'Attendant Care Services; Per 15 Minutes',
        'U5',
        'I10',
        'Essential (primary) hypertension',
        8,
        32,
        15,
        'Weekly',
        '2026-09-01',
        '2027-08-31',
        'approved',
        JSON.stringify([
          'Bathing', 'Dressing', 'Exercise', 'Grooming (Shaving, Oral care, Nail Care)',
          'Grooming (Routine Hair and Skin Care)', 'Toileting', 'Transfer', 'Walking',
          'Meal Prep (breakfast, lunch)', 'Assistance with Medications',
        ]),
        'Demo record modeled on a payer authorization notice — sample identifiers only, not a real member.',
      ]
    );
    await client.query(
      `INSERT INTO billing_lines (id, organization_id, client_id, visit_id, service_authorization_id, service_code, units, service_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), ORG_PRIMARY, 'c1', 'v1', authId, 'S5125', 8, shiftDemoDate('2026-09-14'), 'ready']
    );

    // Training library. Titles reflect the topics a Texas PAS agency
    // actually orients attendants on (the Attendant Orientation form's own
    // confirmation list), with hours captured per course from day one so an
    // annual training report is possible later — see the project doc
    // "caregiver-onboarding-training-spec.md" §6.
    console.log('Seeding training courses…');
    const COURSES = [
      ['Welcome & agency policies', 'Employee handbook highlights, attendance, and call-out procedure.', 20, 0.5, 'initial', 1],
      ['HIPAA & client privacy', 'What PHI is, how to handle it in the home, and what never leaves the house.', 25, 0.5, 'initial', 2],
      ['EVV: clocking in and out', 'Using the Hearth app for visit verification, and what to do when something goes wrong.', 15, 0.25, 'initial', 3],
      ['Personal care & safe transfers', 'Bathing, dressing, toileting and transfer technique without injuring yourself or the client.', 45, 1, 'initial', 4],
      ['Recognizing and reporting abuse & neglect', 'Mandatory reporting duties and how to escalate a concern.', 30, 0.75, 'initial', 5],
      ['Infection control refresher', 'Annual refresher on standard precautions and bloodborne pathogens.', 20, 0.5, 'annual', 6],
    ];
    const courseIds = [];
    for (const [title, description, minutes, hours, type, order] of COURSES) {
      const cid = randomUUID();
      courseIds.push(cid);
      await client.query(
        `INSERT INTO training_courses (id, organization_id, title, description, video_url, duration_minutes, hours, course_type, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [cid, ORG_PRIMARY, title, description, null, minutes, hours, type, order]
      );
    }

    // Credentialing demo state, deliberately uneven so the roster shows the
    // three cases that matter: up to date, due soon, and missing entirely.
    console.log('Seeding credentialing + training completions…');
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const shift = (days) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return iso(d);
    };

    const CHECKS = [
      // cg1 — fully up to date
      ['cg1', 'dps_criminal', shift(-200), shift(165)],
      ['cg1', 'emr', shift(-200), shift(165)],
      ['cg1', 'nar', shift(-200), shift(165)],
      // cg2 — annual re-checks coming due inside 30 days
      ['cg2', 'dps_criminal', shift(-350), shift(15)],
      ['cg2', 'emr', shift(-350), shift(15)],
      ['cg2', 'nar', shift(-350), shift(15)],
      // cg3 — one lapsed
      ['cg3', 'dps_criminal', shift(-400), shift(-35)],
      ['cg3', 'emr', shift(-120), shift(245)],
      ['cg3', 'nar', shift(-120), shift(245)],
      // cg4 — nothing on file at all
    ];
    for (const [cgId, type, completedOn, nextDue] of CHECKS) {
      await client.query(
        `INSERT INTO caregiver_checks (id, organization_id, caregiver_id, check_type, completed_on, next_due_on, performed_by, result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'clear')`,
        [randomUUID(), ORG_PRIMARY, cgId, type, completedOn, nextDue, 'Agency Admin']
      );
    }

    const DOCS = [
      ['cg1', 'application', 'signed'],
      ['cg1', 'confidentiality', 'signed'],
      ['cg1', 'handbook', 'signed'],
      ['cg1', 'hep_b', 'signed'],
      ['cg1', 'i9', 'uploaded'],
      ['cg1', 'tb_screening', 'uploaded'],
      ['cg2', 'application', 'signed'],
      ['cg2', 'confidentiality', 'signed'],
      ['cg2', 'handbook', 'sent'],
      ['cg3', 'application', 'signed'],
    ];
    for (const [cgId, docType, status] of DOCS) {
      await client.query(
        `INSERT INTO caregiver_documents (id, organization_id, caregiver_id, doc_type, status, completed_on)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), ORG_PRIMARY, cgId, docType, status, ['signed', 'uploaded'].includes(status) ? shift(-190) : null]
      );
    }

    // cg1 has finished onboarding training; cg2 is partway through.
    const COMPLETIONS = [
      ['cg1', 0], ['cg1', 1], ['cg1', 2], ['cg1', 3], ['cg1', 4],
      ['cg2', 0], ['cg2', 1],
    ];
    for (const [cgId, idx] of COMPLETIONS) {
      await client.query(
        `INSERT INTO training_completions (id, organization_id, caregiver_id, course_id, hours_credited)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), ORG_PRIMARY, cgId, courseIds[idx], COURSES[idx][3]]
      );
    }

    console.log('Seeding a minimal second organization (tenant-isolation check)…');
    await client.query(
      `INSERT INTO caregivers (id, organization_id, name, role, phone, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      ['cg-second-1', ORG_SECONDARY, 'Renata Cruz', 'Home Health Aide', '555-0100', 'active']
    );
    await client.query(
      `INSERT INTO clients (id, organization_id, name, payer, auth_hours, auth_hours_num, intake_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['c-second-1', ORG_SECONDARY, 'Second Agency Test Client', 'Superior HealthPlan', '10 hrs/wk', 10, new Date().toLocaleDateString('en-US')]
    );
    await client.query(
      `INSERT INTO visits (id, organization_id, caregiver_id, client_id, day, service_date, start_time, end_time, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')`,
      // service_date must be ISO 'YYYY-MM-DD' (was toLocaleDateString, i.e.
      // '9/24/2026', which no date comparison in the app could read).
      ['v-second-1', ORG_SECONDARY, 'cg-second-1', 'c-second-1', dayKeyForIso(todayIso()), todayIso(), '9:00 AM', '11:00 AM']
    );

    console.log('Seeding login accounts…');
    const users = [
      { email: 'coordinator@hearth.demo', password: 'coordinator123', name: 'Jamie Reyes, RN', role: 'COORDINATOR', caregiverId: null, orgId: ORG_PRIMARY },
      { email: 'admin@hearth.demo', password: 'admin123', name: 'Agency Admin', role: 'ADMIN', caregiverId: null, orgId: ORG_PRIMARY },
      { email: 'maria@hearth.demo', password: 'caregiver123', name: 'Maria Alvarez', role: 'CAREGIVER', caregiverId: 'cg1', orgId: ORG_PRIMARY },
      { email: 'denise@hearth.demo', password: 'caregiver123', name: 'Denise Okoye', role: 'CAREGIVER', caregiverId: 'cg2', orgId: ORG_PRIMARY },
      { email: 'thomas@hearth.demo', password: 'caregiver123', name: 'Thomas Grant', role: 'CAREGIVER', caregiverId: 'cg3', orgId: ORG_PRIMARY },
      { email: 'priya@hearth.demo', password: 'caregiver123', name: 'Priya Subramaniam', role: 'CAREGIVER', caregiverId: 'cg4', orgId: ORG_PRIMARY },
      { email: 'admin@secondagency.demo', password: 'admin123', name: 'Second Agency Admin', role: 'ADMIN', caregiverId: null, orgId: ORG_SECONDARY },
    ];
    for (const u of users) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      await client.query(
        // must_change_password = false: demo accounts sign straight in with
        // the README passwords. Real accounts default to true (db/schema.sql).
        `INSERT INTO users (id, organization_id, email, password_hash, name, role, caregiver_id, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
        [randomUUID(), u.orgId, u.email, passwordHash, u.name, u.role, u.caregiverId]
      );
    }

    await client.query('COMMIT');
    console.log('\nDone. Demo logins (see README for the full table):');
    for (const u of users) {
      console.log(`  ${u.role.padEnd(10)} ${u.email}  /  ${u.password}  (${u.orgId})`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
