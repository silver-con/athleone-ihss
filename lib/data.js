// Two kinds of exports live in this file:
//
// 1. Seed data (initialReferrals, initialClients, initialCaregivers,
//    initialVisits, initialMessages) — the starting rows loaded into
//    Postgres by scripts/seed.js. Once seeded, the app reads/writes the
//    database, not this file — re-running `npm run db:seed` resets the
//    demo data back to these values.
// 2. Static reference constants (WEEK_DAYS, the Texas EVV compliance
//    figures, careNeedOptions) that aren't rows in any table — they're
//    fixed lookup values the UI imports directly, same as before.

export const initialReferrals = [
  {
    id: 'r1',
    payer: 'Molina Healthcare',
    clientName: 'Eleanor Whitfield',
    dob: '04/18/1941',
    service: 'Personal Care Services',
    authHours: '15 hrs/wk',
    authNumber: 'MHC-IHSS-88214',
    diagnosis: 'Mobility impairment; assistance needed with ADLs',
    receivedDate: 'Today',
    status: 'new',
    fax: {
      transmittedAt: '09/12/2026 2:47 PM',
      faxNumber: '(555) 555-0142',
      pages: '3, including this cover sheet',
      payerAddress: ['200 Oceangate, Suite 100', 'Long Beach, CA 90802'],
      payerPhone: '(555) 555-0100',
      toLine: 'Hearth Home Care — Intake Department · Fax: (555) 555-0199',
      fromLine: 'Molina Healthcare — Care Coordination · Fax: (555) 555-0142',
      dateLine: '09/12/2026',
      reLine: 'New Member Referral — IHSS Personal Care Services',
      letterDate: 'September 12, 2026',
      medicaidId: '[Member ID on file]',
      effectiveDates: '09/15/2026 – 03/15/2027',
      coordinatorName: 'Jamie Reyes, RN',
      coordinatorPhone: '(555) 555-0142',
    },
  },
  {
    id: 'r2',
    payer: 'Anthem Blue Cross',
    clientName: 'Harold Beckett',
    dob: '11/02/1947',
    service: 'Homemaker Services',
    authHours: '10 hrs/wk',
    authNumber: 'ABC-HH-40217',
    diagnosis: 'Recent hip surgery; homemaker support during recovery',
    receivedDate: 'Yesterday',
    status: 'new',
    fax: null,
  },
  {
    id: 'r3',
    payer: "St. Mary's Hospital",
    clientName: 'Priya Kapoor',
    dob: '07/29/1953',
    service: 'Personal Care Services',
    authHours: '12 hrs/wk',
    authNumber: 'SMH-DC-70932',
    diagnosis: 'Post-discharge recovery; assistance with ADLs',
    receivedDate: '2 days ago',
    status: 'in-progress',
    fax: null,
  },
  {
    id: 'r4',
    payer: 'Molina Healthcare',
    clientName: 'Walter Ibsen',
    dob: '01/09/1938',
    service: 'Personal Care Services',
    authHours: '8 hrs/wk',
    authNumber: 'MHC-IHSS-77031',
    diagnosis: 'Medication management support',
    receivedDate: '3 days ago',
    status: 'completed',
    fax: null,
  },
];

export const initialClients = [
  {
    id: 'c1',
    name: 'Walter Ibsen',
    payer: 'Molina Healthcare',
    hhscIndividualNumber: 'DEMO-100472',
    authHours: '8 hrs/wk',
    authHoursNum: 8,
    intakeDate: '09/09/2026',
    assignedCaregiverId: 'cg1',
    address: '48 Larkspur Lane, Riverton, TX 75201',
    emergencyContact: 'Diane Ibsen (daughter) · (555) 201-4471',
    careNeeds: ['t4', 't3', 't7'],
  },
  {
    id: 'c2',
    name: 'Grace Okafor',
    payer: 'Molina Healthcare',
    authHours: '10 hrs/wk',
    authHoursNum: 10,
    intakeDate: '08/22/2026',
    assignedCaregiverId: 'cg2',
    address: '12 Windmere Court, Riverton, TX 75201',
    emergencyContact: 'Chidi Okafor (son) · (555) 340-9982',
    careNeeds: ['t1', 't5', 't6'],
  },
  {
    id: 'c3',
    name: 'Samuel Ortiz',
    payer: 'Anthem Blue Cross',
    authHours: '6 hrs/wk',
    authHoursNum: 6,
    intakeDate: '08/30/2026',
    assignedCaregiverId: 'cg4',
    address: '905 Birchwood Ave, Riverton, TX 75201',
    emergencyContact: 'Lucia Ortiz (wife) · (555) 118-7723',
    careNeeds: ['t2', 't3', 't5'],
  },
];

export const initialCaregivers = [
  {
    id: 'cg1',
    name: 'Maria Alvarez',
    role: 'Home Care Aide',
    phone: '(555) 013-2245',
    status: 'active',
  },
  {
    id: 'cg2',
    name: 'Denise Okoye',
    role: 'Certified Nursing Assistant',
    phone: '(555) 014-7788',
    status: 'active',
  },
  {
    id: 'cg3',
    name: 'Thomas Grant',
    role: 'Home Care Aide',
    phone: '(555) 019-3321',
    status: 'on-leave',
  },
  {
    id: 'cg4',
    name: 'Priya Subramaniam',
    role: 'Home Care Aide',
    phone: '(555) 022-6690',
    status: 'active',
  },
];

// The prototype's "current week" for the scheduling & EVV views — fixed
// dates (rather than computed from today) so the demo data stays coherent
// no matter when this is run. Tuesday 9/15 is treated as "today": days
// before it have already happened (completed/missed/in-progress visits
// with EVV clock-in data), days after are still just scheduled.
export const WEEK_DAYS = [
  { key: 'mon', label: 'Mon', date: '9/14', iso: '2026-09-14' },
  { key: 'tue', label: 'Tue', date: '9/15', iso: '2026-09-15' },
  { key: 'wed', label: 'Wed', date: '9/16', iso: '2026-09-16' },
  { key: 'thu', label: 'Thu', date: '9/17', iso: '2026-09-17' },
  { key: 'fri', label: 'Fri', date: '9/18', iso: '2026-09-18' },
  { key: 'sat', label: 'Sat', date: '9/19', iso: '2026-09-19' },
  { key: 'sun', label: 'Sun', date: '9/20', iso: '2026-09-20' },
];

export const TODAY_KEY = 'tue';
export const TODAY_ISO = '2026-09-15';

// --- National EVV/compliance reference data -----------------------------
// The state-specific figures that used to live here (visit maintenance
// window, usage threshold, enforcement ladder, usage history, reason
// codes) moved to lib/state-compliance.js's STATE_COMPLIANCE_PROFILES,
// keyed by state, once Hearth stopped being Texas-only — see
// multi-state-expansion-architecture-spec.md (the project doc). Only the
// genuinely universal piece stays here.

// The 6 EVV data elements every visit must capture, per the federal 21st
// Century Cures Act (Sec. 12006) — every state's EVV program is built
// around these, so this part is the same regardless of state.
export const CURES_ACT_ELEMENTS = [
  { id: 'service', label: 'Type of service performed' },
  { id: 'recipient', label: 'The individual receiving the service' },
  { id: 'date', label: 'The date the service was delivered' },
  { id: 'location', label: 'The location of service delivery' },
  { id: 'provider', label: 'The individual providing the service' },
  { id: 'time', label: 'The time the service begins and ends' },
];

// All 50 states + DC, for the provider-info "state" picker
// (SignupForm.js, admin/onboarding, platform's CreateOrganizationForm).
// Listing every state — not just the ones with a compliance profile built
// out yet — lets an agency register accurately even before Hearth has
// built their state's EVV figures; app/admin/compliance/page.js handles
// that gap with an honest "not configured yet" message rather than
// hiding the option.
export const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

// Weekly visit schedule + EVV (Electronic Visit Verification) data for the
// admin scheduling & compliance views. Each visit is one caregiver/client
// shift for one day of the current week. `evv` is null until a visit has
// actually started — scheduled future visits carry no clock-in data yet.
export const initialVisits = [
  // Maria Alvarez (cg1) — Walter Ibsen (c1), Mon/Wed/Fri/Sun 9–11am
  {
    id: 'v1',
    caregiverId: 'cg1',
    clientId: 'c1',
    day: 'mon', serviceDate: '2026-09-14',
    start: '9:00 AM',
    end: '11:00 AM',
    status: 'completed',
    resolved: true,
    evv: {
      clockIn: '9:02 AM',
      clockOut: '11:05 AM',
      method: 'GPS mobile check-in',
      verified: true,
      exception: null,
    },
    tasks: [
      { id: 't4', label: 'Medication reminders', done: true },
      { id: 't3', label: 'Mobility & transferring support', done: true },
      { id: 't7', label: 'Companionship & safety checks', done: true },
    ],
  },
  {
    id: 'v2', caregiverId: 'cg1', clientId: 'c1', day: 'wed', serviceDate: '2026-09-16', start: '9:00 AM', end: '11:00 AM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't4', label: 'Medication reminders', done: false },
      { id: 't3', label: 'Mobility & transferring support', done: false },
      { id: 't7', label: 'Companionship & safety checks', done: false },
    ],
  },
  {
    id: 'v3', caregiverId: 'cg1', clientId: 'c1', day: 'fri', serviceDate: '2026-09-18', start: '9:00 AM', end: '11:00 AM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't4', label: 'Medication reminders', done: false },
      { id: 't3', label: 'Mobility & transferring support', done: false },
      { id: 't7', label: 'Companionship & safety checks', done: false },
    ],
  },
  {
    id: 'v4', caregiverId: 'cg1', clientId: 'c1', day: 'sun', serviceDate: '2026-09-20', start: '9:00 AM', end: '11:00 AM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't4', label: 'Medication reminders', done: false },
      { id: 't3', label: 'Mobility & transferring support', done: false },
      { id: 't7', label: 'Companionship & safety checks', done: false },
    ],
  },

  // Denise Okoye (cg2) — Grace Okafor (c2), Mon–Fri 1–3pm
  {
    id: 'v5',
    caregiverId: 'cg2',
    clientId: 'c2',
    day: 'mon', serviceDate: '2026-09-14',
    start: '1:00 PM',
    end: '3:00 PM',
    status: 'missed',
    resolved: false,
    evv: {
      clockIn: null,
      clockOut: null,
      method: null,
      verified: false,
      exception: '210',
      note: null,
    },
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
      { id: 't6', label: 'Light housekeeping', done: false },
    ],
  },
  {
    id: 'v6',
    caregiverId: 'cg2',
    clientId: 'c2',
    day: 'tue', serviceDate: '2026-09-15',
    start: '1:00 PM',
    end: '3:00 PM',
    status: 'in-progress',
    resolved: true,
    evv: {
      clockIn: '1:05 PM',
      clockOut: null,
      method: 'GPS mobile check-in',
      verified: false,
      exception: null,
    },
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: true },
      { id: 't5', label: 'Meal preparation', done: false },
      { id: 't6', label: 'Light housekeeping', done: false },
    ],
  },
  {
    id: 'v7', caregiverId: 'cg2', clientId: 'c2', day: 'wed', serviceDate: '2026-09-16', start: '1:00 PM', end: '3:00 PM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
      { id: 't6', label: 'Light housekeeping', done: false },
    ],
  },
  {
    id: 'v8', caregiverId: 'cg2', clientId: 'c2', day: 'thu', serviceDate: '2026-09-17', start: '1:00 PM', end: '3:00 PM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
      { id: 't6', label: 'Light housekeeping', done: false },
    ],
  },
  {
    id: 'v9', caregiverId: 'cg2', clientId: 'c2', day: 'fri', serviceDate: '2026-09-18', start: '1:00 PM', end: '3:00 PM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
      { id: 't6', label: 'Light housekeeping', done: false },
    ],
  },

  // Priya Subramaniam (cg4) — Samuel Ortiz (c3), Tue/Thu/Sat 10am–12pm
  {
    id: 'v10',
    caregiverId: 'cg4',
    clientId: 'c3',
    day: 'tue', serviceDate: '2026-09-15',
    start: '10:00 AM',
    end: '12:00 PM',
    status: 'completed',
    resolved: false,
    evv: {
      clockIn: '10:12 AM',
      clockOut: '12:03 PM',
      method: 'Telephony (landline)',
      verified: true,
      exception: '310',
      note: "Caregiver's mobile had no signal at arrival; clocked in via landline once connected.",
    },
    tasks: [
      { id: 't2', label: 'Dressing assistance', done: true },
      { id: 't3', label: 'Mobility & transferring support', done: true },
      { id: 't5', label: 'Meal preparation', done: true },
    ],
  },
  {
    id: 'v11', caregiverId: 'cg4', clientId: 'c3', day: 'thu', serviceDate: '2026-09-17', start: '10:00 AM', end: '12:00 PM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't2', label: 'Dressing assistance', done: false },
      { id: 't3', label: 'Mobility & transferring support', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
    ],
  },
  {
    id: 'v12', caregiverId: 'cg4', clientId: 'c3', day: 'sat', serviceDate: '2026-09-19', start: '10:00 AM', end: '12:00 PM', status: 'scheduled', resolved: true, evv: null,
    tasks: [
      { id: 't2', label: 'Dressing assistance', done: false },
      { id: 't3', label: 'Mobility & transferring support', done: false },
      { id: 't5', label: 'Meal preparation', done: false },
    ],
  },

  // --- Visit Maintenance backlog (older visits, not on the current week's
  // grid — `day: null` keeps them off the /admin/schedule view) — these
  // exist to demonstrate Texas's 95-day EVV visit maintenance window on the
  // Compliance Center: v13 is nearly out of time to fix without a Visit
  // Maintenance Unlock Request; v14 already missed the window entirely.
  {
    id: 'v13',
    caregiverId: 'cg2',
    clientId: 'c2',
    day: null,
    serviceDate: '2026-06-16',
    start: '1:00 PM',
    end: '3:00 PM',
    status: 'completed',
    resolved: false,
    evv: {
      clockIn: '1:40 PM',
      clockOut: '3:00 PM',
      method: 'GPS mobile check-in',
      verified: false,
      exception: '600',
      note: 'Clocked in late — app crashed and had to be reinstalled mid-visit. Needs office sign-off before it locks.',
    },
    tasks: [
      { id: 't1', label: 'Bathing & grooming assistance', done: true },
      { id: 't5', label: 'Meal preparation', done: true },
      { id: 't6', label: 'Light housekeeping', done: true },
    ],
  },
  {
    id: 'v14',
    caregiverId: 'cg1',
    clientId: 'c1',
    day: null,
    serviceDate: '2026-06-07',
    start: '9:00 AM',
    end: '11:00 AM',
    status: 'completed',
    resolved: false,
    evv: {
      clockIn: null,
      clockOut: '11:10 AM',
      method: 'GPS mobile check-in',
      verified: false,
      exception: '210',
      note: 'Clock-in never registered (phone was in airplane mode); clock-out captured. Flagged after the maintenance window closed.',
    },
    tasks: [
      { id: 't4', label: 'Medication reminders', done: true },
      { id: 't3', label: 'Mobility & transferring support', done: true },
      { id: 't7', label: 'Companionship & safety checks', done: true },
    ],
  },

  // Thomas Grant (cg3) is on leave this week — no visits scheduled, which
  // shows up as a coverage gap on the schedule view.
];

export const careNeedOptions = [
  { id: 't1', label: 'Bathing & grooming assistance' },
  { id: 't2', label: 'Dressing assistance' },
  { id: 't3', label: 'Mobility & transferring support' },
  { id: 't4', label: 'Medication reminders' },
  { id: 't5', label: 'Meal preparation' },
  { id: 't6', label: 'Light housekeeping' },
  { id: 't7', label: 'Companionship & safety checks' },
];

// One message thread per caregiver with "the office" — used by the
// caregiver mobile app's Messages tab. `mine: true` renders as the
// caregiver's own outgoing bubble.
export const initialMessages = [
  {
    id: 'msg1',
    caregiverId: 'cg1',
    sender: 'Jamie Reyes, RN',
    text: "Morning Maria — Walter's daughter mentioned he's had some new dizziness. Keep an eye on it during today's visit and note anything unusual.",
    time: 'Mon 8:14 AM',
    mine: false,
  },
  {
    id: 'msg2',
    caregiverId: 'cg1',
    sender: 'Maria Alvarez',
    text: "Got it, thank you — I'll check in on that and let you know how he's doing.",
    time: 'Mon 8:20 AM',
    mine: true,
  },
  {
    id: 'msg3',
    caregiverId: 'cg1',
    sender: 'Jamie Reyes, RN',
    text: 'Appreciate it! Also — your Sunday 9am visit with Walter is confirmed on the new schedule.',
    time: 'Mon 4:45 PM',
    mine: false,
  },
  {
    id: 'msg4',
    caregiverId: 'cg2',
    sender: 'Office',
    text: "Denise — we show no clock-in for your Monday 1pm visit with Grace Okafor. Can you give us a call when you get a chance?",
    time: 'Mon 3:30 PM',
    mine: false,
  },
  {
    id: 'msg5',
    caregiverId: 'cg4',
    sender: 'Office',
    text: 'Reminder: Samuel Ortiz has a follow-up appointment Thursday afternoon, after your visit — no schedule changes needed on your end.',
    time: 'Mon 11:02 AM',
    mine: false,
  },
];
