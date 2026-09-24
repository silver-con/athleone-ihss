// Central access-control catalog.
//
// This app has four fixed roles (ADMIN, COORDINATOR, CAREGIVER,
// PLATFORM_ADMIN — see multitenant-hhaexchange-architecture-spec.md). Until
// 2026-09-17, access control lived in two disconnected places: proxy.js
// checked a *role* against a coarse path-prefix table, and each Server
// Action separately called `requireSession(['ROLE', ...])` inline. Neither
// one named *what* was being protected, so there was no single place that
// answered "what can a Coordinator do?" or "who can touch EVV credentials?"
//
// This file is that single place. Every distinct page/route grouping and
// every Server Action in the app maps to exactly one permission key below.
// Each key's `roles` array was set by reading the *pre-existing* check it
// replaces (proxy.js's ROLE_PREFIXES for pages, the inline requireSession()
// call for actions) — so adding this catalog and switching the app to use
// it is a zero-behavior-change refactor. Nobody gains or loses access on
// the day this ships.
//
// What this buys going forward: because every function has its own key
// instead of sharing one role check, narrowing access later — e.g. "let
// this Admin see Finance but not EVV credentials" — is a one-line change to
// that key's `roles` (or, for a future per-user override, a lookup this
// catalog can grow to support) instead of hunting down every requireSession
// call that happens to list 'ADMIN'.
//
// kind: 'page' entries are enforced by proxy.js via ROUTE_PERMISSIONS below.
// kind: 'action' entries are enforced by each Server Action calling
// requirePermission(key) (see actions/auth.js) in place of the old
// requireSession(['ROLE', ...]) call.

// Five fixed session roles across three tiers: PLATFORM_ADMIN owns the
// platform, ADMIN owns one organization, LOCATION_ADMIN owns one location
// inside that organization, and COORDINATOR / CAREGIVER are staff roles.
// LOCATION_ADMIN was added 2026-09-17 when the three-tier model was
// settled; it reuses the /admin route tree rather than getting its own,
// with this catalog deciding which of those pages it may reach and
// session.locationId narrowing every query to its own location.
export const ROLES = ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN', 'CAREGIVER', 'PLATFORM_ADMIN'];

// Where each role lands after login, and where proxy.js sends a signed-in
// user whose role doesn't hold the permission a route needs. One map for
// both call sites — they drifted out of sync once already (proxy.js's own
// inline copy never learned about LOCATION_ADMIN when that role was added,
// so a location admin denied a page fell through to COORDINATOR's home
// instead of their own /admin).
export const ROLE_HOME = {
  ADMIN: '/admin',
  // A location admin lands on the same dashboard as the org admin — the
  // pages are shared and every query narrows on session.locationId, so
  // they simply see their own location's slice of it.
  LOCATION_ADMIN: '/admin',
  COORDINATOR: '/referrals',
  CAREGIVER: '/caregiver',
  PLATFORM_ADMIN: '/platform',
};

// Where an account on a starting or just-reset password is sent until it
// sets its own (proxy.js for pages, actions/auth.js requireSession for
// Server Actions).
export const CHANGE_PASSWORD_PATH = '/account/password';

const ALL_TENANT_ROLES = ['ADMIN', 'LOCATION_ADMIN', 'COORDINATOR', 'CAREGIVER'];

export const PERMISSIONS = {
  // ---------------------------------------------------------------------
  // Own account — every signed-in tenant account.
  // ---------------------------------------------------------------------
  'shared.account.password.view': {
    kind: 'page',
    area: 'Account',
    label: 'Change your own password',
    route: 'app/account/password/page.js',
    roles: ALL_TENANT_ROLES,
  },
  'shared.account.password.change': {
    kind: 'action',
    area: 'Account',
    label: 'Change your own password',
    file: 'actions/account.js',
    actions: ['changePasswordAction'],
    roles: ALL_TENANT_ROLES,
    note: 'Deliberately usable while must_change_password is set — it is the way out of that state — so the action checks getSession() itself rather than going through requirePermission/requireSession.',
  },

  // ---------------------------------------------------------------------
  // Admin area — today, proxy.js's ROLE_PREFIXES let only ADMIN reach any
  // /admin/* page at all. That coarse gate is preserved exactly for the
  // *pages* below (each still lists only ADMIN); several *actions* invoked
  // from these pages have always separately allowed COORDINATOR too (see
  // the `note` on admin.finance.manage, admin.carePlans.manage,
  // admin.caregiverHr.manage, admin.orientations.manage and
  // admin.training.manage) — a pre-existing gap where Coordinator holds the
  // action permission but can't reach the page to use it. Preserved as-is;
  // flagged so it's a deliberate decision if it's ever closed.
  // ---------------------------------------------------------------------
  'admin.dashboard.view': {
    kind: 'page',
    area: 'Admin',
    label: 'Admin dashboard',
    route: 'app/admin/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.caregivers.login.manage': {
    kind: 'action',
    area: 'Admin / Caregivers',
    label: "Reset a caregiver's sign-in password",
    file: 'actions/team.js',
    actions: ['resetCaregiverPasswordAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
    note: 'LOCATION_ADMIN is limited to caregivers in their own location (resetCaregiverLoginPassword filters by session.locationId).',
  },
  'admin.team.view': {
    kind: 'page',
    area: 'Admin / Team',
    label: 'Organization staff (admins, location admins, coordinators)',
    route: 'app/admin/team/page.js',
    roles: ['ADMIN'],
  },
  'admin.team.manage': {
    kind: 'action',
    area: 'Admin / Team',
    label: 'Create an office account (admin / location admin / coordinator)',
    file: 'actions/team.js',
    actions: [
      'createTeamMemberAction',
      'setTeamMemberActiveAction',
      'updateTeamMemberAccessAction',
      'resetTeamMemberPasswordAction',
    ],
    roles: ['ADMIN'],
    note: 'Org-admin only: this action can mint another organization-wide ADMIN, so it is deliberately not granted to LOCATION_ADMIN. Letting a location admin staff its own branch would need its own narrower key. Deactivate / role change / password reset refuse to act on the caller themselves or to remove the last active ADMIN (lib/queries.js requireManageableStaff / countOtherActiveAdmins).',
  },
  'admin.locations.view': {
    kind: 'page',
    area: 'Admin / Locations',
    label: 'Locations & franchise revenue rollup',
    route: 'app/admin/locations/page.js',
    roles: ['ADMIN'],
  },
  'admin.locations.manage': {
    kind: 'action',
    area: 'Admin / Locations',
    label: 'Add / configure a location, and move staff or clients between locations',
    file: 'actions/locations.js',
    actions: [
      'createLocationAction',
      'updateLocationAction',
      'setCaregiverLocationAction',
      'setClientLocationAction',
    ],
    roles: ['ADMIN'],
    note: 'Org-admin only, deliberately — a location is a franchise/branch grant under the agency\'s own license (Medicaid provider number, HCSSA license, EVV/DocuSign credentials stay org-wide, see db/schema.sql), not something a location itself should be able to create.',
  },
  'admin.finance.view': {
    kind: 'page',
    area: 'Admin / Finance',
    label: 'Finance & billing dashboard',
    route: 'app/admin/finance/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.finance.manage': {
    kind: 'action',
    area: 'Admin / Finance',
    label: 'Create / update billing lines',
    file: 'actions/billing.js',
    actions: ['updateBillingLineStatusAction', 'createBillingLineAction'],
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
    note: 'COORDINATOR holds this action permission but cannot reach admin.finance.view today (pre-existing gap, preserved as-is).',
  },
  'admin.caregivers.list.view': {
    kind: 'page',
    area: 'Admin / Caregivers',
    label: 'Caregiver roster',
    route: 'app/admin/caregivers/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.caregivers.detail.view': {
    kind: 'page',
    area: 'Admin / Caregivers',
    label: 'Caregiver detail (HR record)',
    route: 'app/admin/caregivers/[id]/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.caregivers.manage': {
    kind: 'action',
    area: 'Admin / Caregivers',
    label: 'Add / activate / toggle caregiver status',
    file: 'actions/admin.js, actions/onboarding.js',
    actions: ['toggleCaregiverStatusAction', 'addCaregiverAction', 'activateCaregiverAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.caregiverHr.manage': {
    kind: 'action',
    area: 'Admin / Caregivers',
    label: 'Record background checks / HR documents',
    file: 'actions/caregiver-hr.js',
    actions: ['recordCheckAction', 'updateDocumentAction'],
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
    note: 'COORDINATOR holds this action permission but cannot reach admin.caregivers.detail.view today (pre-existing gap, preserved as-is).',
  },
  'admin.caregiverHr.statusOverride': {
    kind: 'action',
    area: 'Admin / Caregivers',
    label: 'Manually override a caregiver’s HR status',
    file: 'actions/caregiver-hr.js',
    actions: ['setCaregiverStatusAction'],
    roles: ['ADMIN'],
  },
  'admin.carePlans.view': {
    kind: 'page',
    area: 'Admin / Clients',
    label: 'Agency-wide care plans / authorizations overview',
    route: 'app/admin/care-plans/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.clients.list.view': {
    kind: 'page',
    area: 'Admin / Clients',
    label: 'Agency-wide client roster & caregiver assignment',
    route: 'app/admin/clients/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.clients.manage': {
    kind: 'action',
    area: 'Admin / Clients',
    label: 'Assign / reassign a caregiver to a client',
    file: 'actions/admin.js',
    actions: ['assignCaregiverAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.clients.carePlan.view': {
    kind: 'page',
    area: 'Admin / Clients',
    label: 'Client care plan (authorizations, orientations)',
    route: 'app/admin/clients/[id]/care-plan/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.clients.evvIdentity.manage': {
    kind: 'action',
    area: 'Admin / Clients',
    label: "Edit a client's EVV identity (Medicaid ID, date of birth, service address)",
    file: 'actions/care-plans.js',
    actions: ['updateClientEvvIdentityAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.carePlans.manage': {
    kind: 'action',
    area: 'Admin / Clients',
    label: 'Create a service authorization',
    file: 'actions/care-plans.js',
    actions: ['createAuthorizationAction'],
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
    note: 'COORDINATOR holds this action permission but cannot reach admin.clients.carePlan.view today (pre-existing gap, preserved as-is).',
  },
  'admin.compliance.view': {
    kind: 'page',
    area: 'Admin / Compliance',
    label: 'Compliance / visit-exception dashboard',
    route: 'app/admin/compliance/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.evv.exceptions.manage': {
    kind: 'action',
    area: 'Admin / Compliance',
    label: 'Visit maintenance (reason codes, missing times, verification) / record a VMUR',
    file: 'actions/admin.js',
    actions: ['performVisitMaintenanceAction', 'recordVisitVmurAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
    note: 'LOCATION_ADMIN is limited to visits in their own location (performVisitMaintenance / recordVisitVmur look the visit up with session.locationId).',
  },
  'admin.esign.view': {
    kind: 'page',
    area: 'Admin / E-Signature',
    label: 'DocuSign settings',
    route: 'app/admin/esign/page.js',
    roles: ['ADMIN'],
  },
  'admin.esign.manage': {
    kind: 'action',
    area: 'Admin / E-Signature',
    label: 'Save / test DocuSign credentials',
    file: 'actions/docusign.js',
    actions: ['saveDocusignCredentialsAction', 'testDocusignConnectionAction'],
    roles: ['ADMIN'],
  },
  'admin.evv.maintenance.view': {
    kind: 'page',
    area: 'Admin / EVV',
    label: 'Visit maintenance for one visit (record, history, correction form)',
    route: 'app/admin/evv/visits/[id]/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.settings.view': {
    kind: 'page',
    area: 'Admin / Settings',
    label: 'Agency settings (flexible hours, visit maintenance deadline)',
    route: 'app/admin/settings/page.js',
    roles: ['ADMIN'],
  },
  'admin.settings.manage': {
    kind: 'action',
    area: 'Admin / Settings',
    label: 'Change agency settings',
    file: 'actions/settings.js',
    actions: ['updateEvvSettingsAction'],
    roles: ['ADMIN'],
  },
  'admin.evv.dashboard.view': {
    kind: 'page',
    area: 'Admin / EVV',
    label: 'EVV compliance dashboard',
    route: 'app/admin/evv/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.evv.sync.view': {
    kind: 'page',
    area: 'Admin / EVV',
    label: 'HHAeXchange EVV credentials & sync log',
    route: 'app/admin/evv/sync/page.js',
    roles: ['ADMIN'],
  },
  'admin.evv.credentials.manage': {
    kind: 'action',
    area: 'Admin / EVV',
    label: 'Save / test HHAeXchange credentials',
    file: 'actions/evv.js',
    actions: ['saveEvvCredentialsAction', 'testEvvConnectionAction'],
    roles: ['ADMIN'],
  },
  'admin.evv.sync.manage': {
    kind: 'action',
    area: 'Admin / EVV',
    label: 'Run / retry an EVV sync',
    file: 'actions/evv.js',
    actions: ['runEvvSyncAction', 'retrySyncRowAction'],
    roles: ['ADMIN'],
  },
  // ADMIN-only, deliberately not LOCATION_ADMIN — same reasoning as
  // admin.evv.sync.view and admin.locations.view above: this page shows
  // every location's activity, not just the viewer's own, so it follows
  // the app's existing "cross-location detail is ADMIN-only" pattern
  // rather than opening a new exception to it. A LOCATION_ADMIN's own
  // actions still get logged to audit_log — they just can't read the log.
  'admin.auditLog.view': {
    kind: 'page',
    area: 'Admin / Audit',
    label: 'Tenant audit trail (care plans, billing, EVV credentials)',
    route: 'app/admin/audit-log/page.js',
    roles: ['ADMIN'],
  },
  'admin.onboarding.view': {
    kind: 'page',
    area: 'Admin / Tenant onboarding',
    label: 'Go-live checklist',
    route: 'app/admin/onboarding/page.js',
    roles: ['ADMIN'],
  },
  'admin.onboarding.manage': {
    kind: 'action',
    area: 'Admin / Tenant onboarding',
    label: 'Update provider info / enrollment / BAA attestation',
    file: 'actions/tenant-onboarding.js',
    actions: ['updateProviderInfoAction', 'updateProviderEnrollmentAction', 'updateBaaSignedAction'],
    roles: ['ADMIN'],
  },
  'admin.orientations.detail.view': {
    kind: 'page',
    area: 'Admin / Orientations',
    label: 'Orientation detail',
    route: 'app/admin/orientations/[id]/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.orientations.manage': {
    kind: 'action',
    area: 'Admin / Orientations',
    label: 'Create / complete / send / check an orientation for signature',
    file: 'actions/orientations.js, actions/docusign.js',
    actions: [
      'createOrientationAction',
      'completeOrientationAction',
      'startOrientationSigningAction',
      'checkOrientationSigningStatusAction',
    ],
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
    note: 'COORDINATOR holds this action permission but cannot reach admin.clients.carePlan.view / admin.orientations.detail.view today (pre-existing gap, preserved as-is).',
  },
  'admin.schedule.view': {
    kind: 'page',
    area: 'Admin / Schedule',
    label: 'Agency-wide schedule',
    route: 'app/admin/schedule/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.schedule.manage': {
    kind: 'action',
    area: 'Admin / Schedule',
    label: 'Schedule a visit',
    file: 'actions/schedule.js',
    actions: ['createVisitAction'],
    roles: ['ADMIN', 'LOCATION_ADMIN'],
    note: 'There was previously no writer for visits at all — every visit came from seed data or a QA fixture. This is the first real write path.',
  },
  'admin.training.view': {
    kind: 'page',
    area: 'Admin / Training',
    label: 'Course library management',
    route: 'app/admin/training/page.js',
    roles: ['ADMIN', 'LOCATION_ADMIN'],
  },
  'admin.training.manage': {
    kind: 'action',
    area: 'Admin / Training',
    label: 'Create a course',
    file: 'actions/training.js',
    actions: ['createCourseAction'],
    roles: ['ADMIN', 'COORDINATOR'],
    note: 'COORDINATOR holds this action permission but cannot reach admin.training.view today (pre-existing gap, preserved as-is).',
  },

  // ---------------------------------------------------------------------
  // Shared Coordinator/Admin area — the app/(dashboard)/* route group and
  // /fax, reachable by both roles today per proxy.js.
  // ---------------------------------------------------------------------
  'shared.clients.view': {
    kind: 'page',
    area: 'Shared / Clients',
    label: 'Caseload client list (read-only)',
    route: 'app/(dashboard)/clients/page.js',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },
  'shared.referrals.list.view': {
    kind: 'page',
    area: 'Shared / Referrals',
    label: 'Referral queue',
    route: 'app/(dashboard)/referrals/page.js',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },
  'shared.referrals.create.view': {
    kind: 'page',
    area: 'Shared / Referrals',
    label: 'Manual referral entry',
    route: 'app/(dashboard)/referrals/new/page.js',
    note: 'Stand-in for fax/OCR intake (still deferred) so a self-service agency has a way to get its first client into the system.',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },
  'shared.referrals.detail.view': {
    kind: 'page',
    area: 'Shared / Referrals',
    label: 'Referral detail',
    route: 'app/(dashboard)/referrals/[id]/page.js',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },
  'shared.referrals.intake.view': {
    kind: 'page',
    area: 'Shared / Referrals',
    label: 'Intake form',
    route: 'app/(dashboard)/referrals/[id]/intake/page.js',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },
  'shared.referrals.manage': {
    kind: 'action',
    area: 'Shared / Referrals',
    label: 'Submit an intake / create a referral',
    file: 'actions/referrals.js',
    actions: ['submitIntakeAction', 'createReferralAction'],
    roles: ['COORDINATOR', 'ADMIN', 'LOCATION_ADMIN'],
  },
  'shared.fax.view': {
    kind: 'page',
    area: 'Shared / Fax',
    label: 'Inbound fax viewer',
    route: 'app/fax/[id]/page.js',
    roles: ['ADMIN', 'COORDINATOR', 'LOCATION_ADMIN'],
  },

  // ---------------------------------------------------------------------
  // Caregiver area — CAREGIVER only, per proxy.js. Every action here also
  // independently re-checks that the record being touched belongs to the
  // signed-in caregiver (see actions/caregiver.js's top-of-file note) —
  // this permission layer answers "is this a caregiver," not "is this
  // *their* record," which stays enforced inline.
  // ---------------------------------------------------------------------
  'caregiver.dashboard.view': {
    kind: 'page',
    area: 'Caregiver',
    label: 'Caregiver dashboard',
    route: 'app/caregiver/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.clients.list.view': {
    kind: 'page',
    area: 'Caregiver',
    label: 'My clients',
    route: 'app/caregiver/clients/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.clients.detail.view': {
    kind: 'page',
    area: 'Caregiver',
    label: 'Client detail',
    route: 'app/caregiver/clients/[id]/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.messages.view': {
    kind: 'page',
    area: 'Caregiver',
    label: 'Messages',
    route: 'app/caregiver/messages/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.messages.send': {
    kind: 'action',
    area: 'Caregiver',
    label: 'Send a message',
    file: 'actions/caregiver.js',
    actions: ['sendMessageAction'],
    roles: ['CAREGIVER'],
  },
  'caregiver.onboarding.view': {
    kind: 'page',
    area: 'Caregiver / Onboarding',
    label: 'Onboarding checklist',
    route: 'app/caregiver/onboarding/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.onboarding.sign': {
    kind: 'action',
    area: 'Caregiver / Onboarding',
    label: 'Start e-signing the onboarding packet',
    file: 'actions/docusign.js',
    actions: ['startPacketSigningAction'],
    roles: ['CAREGIVER'],
  },
  'caregiver.onboarding.application.view': {
    kind: 'page',
    area: 'Caregiver / Onboarding',
    label: 'Employment application form',
    route: 'app/caregiver/onboarding/application/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.onboarding.signReturn': {
    kind: 'route',
    area: 'Caregiver / Onboarding',
    label: 'DocuSign embedded-signing return callback (GET)',
    route: 'app/caregiver/onboarding/sign/return/route.js',
    roles: ['CAREGIVER'],
    note: 'Route Handler, not a Server Action — also independently checks session?.caregiverId inline (see the file) rather than relying on proxy.js alone, since DocuSign redirects here with a plain GET.',
  },
  'caregiver.onboarding.apply': {
    kind: 'action',
    area: 'Caregiver / Onboarding',
    label: 'Submit the employment application',
    file: 'actions/onboarding.js',
    actions: ['submitApplicationAction'],
    roles: ['CAREGIVER'],
  },
  'caregiver.schedule.view': {
    kind: 'page',
    area: 'Caregiver',
    label: 'My schedule',
    route: 'app/caregiver/schedule/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.training.view': {
    kind: 'page',
    area: 'Caregiver / Training',
    label: 'My training',
    route: 'app/caregiver/training/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.training.complete': {
    kind: 'action',
    area: 'Caregiver / Training',
    label: 'Mark a course complete',
    file: 'actions/training.js',
    actions: ['markCourseCompleteAction'],
    roles: ['CAREGIVER'],
  },
  'caregiver.visit.view': {
    kind: 'page',
    area: 'Caregiver / Visits',
    label: 'Visit detail',
    route: 'app/caregiver/visit/[id]/page.js',
    roles: ['CAREGIVER'],
  },
  'caregiver.visit.clock': {
    kind: 'action',
    area: 'Caregiver / Visits',
    label: 'Clock in / out of a visit',
    file: 'actions/caregiver.js',
    actions: ['clockInAction', 'clockOutAction'],
    roles: ['CAREGIVER'],
  },
  'caregiver.visit.tasks': {
    kind: 'action',
    area: 'Caregiver / Visits',
    label: 'Toggle a visit task',
    file: 'actions/caregiver.js',
    actions: ['toggleVisitTaskAction'],
    roles: ['CAREGIVER'],
  },

  // ---------------------------------------------------------------------
  // Platform area — PLATFORM_ADMIN only. See actions/platform.js's
  // top-of-file comment: this role can view every organization and, as of
  // the one action below, create a new one, but still cannot view, edit,
  // suspend, or log into any organization that already exists. That
  // boundary is enforced in lib/queries.js, not here — this catalog only
  // says who may reach the /platform surface and its one write action.
  // ---------------------------------------------------------------------
  'platform.dashboard.view': {
    kind: 'page',
    area: 'Platform',
    label: 'Platform admin dashboard (all organizations, read-only)',
    route: 'app/platform/page.js',
    roles: ['PLATFORM_ADMIN'],
  },
  'platform.organizations.create': {
    kind: 'action',
    area: 'Platform',
    label: 'Onboard a brand-new agency',
    file: 'actions/platform.js',
    actions: ['createOrganizationAction'],
    roles: ['PLATFORM_ADMIN'],
  },
  // Platform TEAM management (app/platform/admins) — who else has
  // PLATFORM_ADMIN access, as opposed to the entries above which are about
  // agencies/tenants. See actions/platform.js's comment on
  // createPlatformAdminAction/togglePlatformAdminActiveAction.
  'platform.admins.view': {
    kind: 'page',
    area: 'Platform',
    label: 'Platform team (list of platform admins)',
    route: 'app/platform/admins/page.js',
    roles: ['PLATFORM_ADMIN'],
  },
  'platform.admins.create': {
    kind: 'action',
    area: 'Platform',
    label: 'Add a platform admin',
    file: 'actions/platform.js',
    actions: ['createPlatformAdminAction'],
    roles: ['PLATFORM_ADMIN'],
  },
  'platform.admins.manage': {
    kind: 'action',
    area: 'Platform',
    label: 'Activate/deactivate a platform admin',
    file: 'actions/platform.js',
    actions: ['togglePlatformAdminActiveAction'],
    roles: ['PLATFORM_ADMIN'],
  },
  // Per-tenant drill-down from the platform dashboard table — same
  // read-only, cross-tenant visibility level as platform.dashboard.view
  // (a platform admin can already see every agency in aggregate; this is
  // just a deeper view of one), so it gets the same PLATFORM_ADMIN-only
  // gate rather than a new access tier.
  'platform.organizations.view': {
    kind: 'page',
    area: 'Platform',
    label: 'Single-agency detail dashboard (read-only)',
    route: 'app/platform/organizations/[id]/page.js',
    roles: ['PLATFORM_ADMIN'],
  },
};

// Public routes — no session required at all. Listed here purely so the
// access-control map is a complete picture of every route in the app, not
// just the protected ones. proxy.js does not consult this list; it protects
// everything NOT under one of these prefixes' equivalent (see proxy.js's
// own PROTECTED_PREFIXES).
export const PUBLIC_ROUTES = [
  { route: 'app/page.js', label: 'Landing page' },
  { route: 'app/login/page.js', label: 'Login' },
  // Still public, but only as a redirect to /login — self-service signup
  // was closed 2026-09-17 and its Server Action now refuses. Organizations
  // are created by a platform admin (platform.organizations.create).
  { route: 'app/signup/page.js', label: 'Closed signup (redirects to /login)' },
];

/** Pure check: does this role hold this permission? Never throws. */
export function hasPermission(role, permissionKey) {
  const entry = PERMISSIONS[permissionKey];
  if (!entry) return false;
  return entry.roles.includes(role);
}

/** Same check, taking a session (or null) instead of a bare role string. */
export function sessionHasPermission(session, permissionKey) {
  if (!session) return false;
  return hasPermission(session.role, permissionKey);
}

// ---------------------------------------------------------------------
// Route -> permission-key table for proxy.js. Order matters: the first
// matching entry wins, so the most specific path pattern for a given area
// is listed before its parent. Each area ends with a same-prefix catch-all
// pointing at that area's top-level page permission, so a future page
// added under an existing prefix without an explicit entry here still
// fails safe to that area's existing (coarse) access level rather than
// being left completely unprotected.
// ---------------------------------------------------------------------
export const ROUTE_PERMISSIONS = [
  // Admin
  { test: (p) => /^\/admin\/clients\/[^/]+\/care-plan(\/.*)?$/.test(p), key: 'admin.clients.carePlan.view' },
  { test: (p) => /^\/admin\/clients(\/.*)?$/.test(p), key: 'admin.clients.list.view' },
  { test: (p) => /^\/admin\/care-plans(\/.*)?$/.test(p), key: 'admin.carePlans.view' },
  { test: (p) => /^\/admin\/caregivers\/[^/]+(\/.*)?$/.test(p), key: 'admin.caregivers.detail.view' },
  { test: (p) => /^\/admin\/caregivers(\/.*)?$/.test(p), key: 'admin.caregivers.list.view' },
  { test: (p) => /^\/admin\/orientations\/[^/]+(\/.*)?$/.test(p), key: 'admin.orientations.detail.view' },
  { test: (p) => /^\/admin\/evv\/sync(\/.*)?$/.test(p), key: 'admin.evv.sync.view' },
  { test: (p) => /^\/admin\/evv\/visits\/[^/]+$/.test(p), key: 'admin.evv.maintenance.view' },
  { test: (p) => /^\/admin\/settings(\/.*)?$/.test(p), key: 'admin.settings.view' },
  { test: (p) => /^\/admin\/evv(\/.*)?$/.test(p), key: 'admin.evv.dashboard.view' },
  { test: (p) => /^\/admin\/audit-log(\/.*)?$/.test(p), key: 'admin.auditLog.view' },
  { test: (p) => /^\/admin\/finance(\/.*)?$/.test(p), key: 'admin.finance.view' },
  { test: (p) => /^\/admin\/compliance(\/.*)?$/.test(p), key: 'admin.compliance.view' },
  { test: (p) => /^\/admin\/esign(\/.*)?$/.test(p), key: 'admin.esign.view' },
  { test: (p) => /^\/admin\/onboarding(\/.*)?$/.test(p), key: 'admin.onboarding.view' },
  { test: (p) => /^\/admin\/schedule(\/.*)?$/.test(p), key: 'admin.schedule.view' },
  { test: (p) => /^\/admin\/training(\/.*)?$/.test(p), key: 'admin.training.view' },
  { test: (p) => /^\/admin\/locations(\/.*)?$/.test(p), key: 'admin.locations.view' },
  { test: (p) => /^\/admin\/team(\/.*)?$/.test(p), key: 'admin.team.view' },
  // Catch-all for any future /admin/* page not yet listed above — fails
  // safe to the same ADMIN-only gate the whole area has always had.
  { test: (p) => /^\/admin(\/.*)?$/.test(p), key: 'admin.dashboard.view' },

  // Own account
  { test: (p) => /^\/account\/password$/.test(p), key: 'shared.account.password.view' },

  // Shared Coordinator/Admin
  { test: (p) => /^\/referrals\/[^/]+\/intake(\/.*)?$/.test(p), key: 'shared.referrals.intake.view' },
  { test: (p) => /^\/referrals\/new$/.test(p), key: 'shared.referrals.create.view' },
  { test: (p) => /^\/referrals\/[^/]+(\/.*)?$/.test(p), key: 'shared.referrals.detail.view' },
  { test: (p) => /^\/referrals(\/.*)?$/.test(p), key: 'shared.referrals.list.view' },
  { test: (p) => /^\/clients(\/.*)?$/.test(p), key: 'shared.clients.view' },
  { test: (p) => /^\/fax(\/.*)?$/.test(p), key: 'shared.fax.view' },

  // Caregiver
  { test: (p) => /^\/caregiver\/clients\/[^/]+(\/.*)?$/.test(p), key: 'caregiver.clients.detail.view' },
  { test: (p) => /^\/caregiver\/clients(\/.*)?$/.test(p), key: 'caregiver.clients.list.view' },
  { test: (p) => /^\/caregiver\/messages(\/.*)?$/.test(p), key: 'caregiver.messages.view' },
  { test: (p) => /^\/caregiver\/onboarding\/application(\/.*)?$/.test(p), key: 'caregiver.onboarding.application.view' },
  { test: (p) => /^\/caregiver\/onboarding(\/.*)?$/.test(p), key: 'caregiver.onboarding.view' },
  { test: (p) => /^\/caregiver\/schedule(\/.*)?$/.test(p), key: 'caregiver.schedule.view' },
  { test: (p) => /^\/caregiver\/training(\/.*)?$/.test(p), key: 'caregiver.training.view' },
  { test: (p) => /^\/caregiver\/visit\/[^/]+(\/.*)?$/.test(p), key: 'caregiver.visit.view' },
  // Catch-all for any future /caregiver/* page not yet listed above.
  { test: (p) => /^\/caregiver(\/.*)?$/.test(p), key: 'caregiver.dashboard.view' },

  // Platform
  { test: (p) => /^\/platform\/admins(\/.*)?$/.test(p), key: 'platform.admins.view' },
  { test: (p) => /^\/platform\/organizations(\/.*)?$/.test(p), key: 'platform.organizations.view' },
  { test: (p) => /^\/platform(\/.*)?$/.test(p), key: 'platform.dashboard.view' },
];

/**
 * Flattened, sorted list of every permission entry for printing a
 * human-readable access-control map (see also
 * multitenant-hhaexchange-architecture-spec.md's "Access control" section,
 * which links here rather than reproducing this table by hand).
 */
export function getAccessControlMap() {
  return Object.entries(PERMISSIONS)
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => (a.area === b.area ? a.key.localeCompare(b.key) : a.area.localeCompare(b.area)));
}
