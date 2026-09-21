// Per-state EVV compliance reference data: reason codes, the quarterly
// usage-score minimum, the enforcement ladder, and the visit-maintenance
// correction window. Everything in a state's profile here used to be
// hardcoded directly into lib/data.js and the Compliance Center page as
// if Texas's numbers were the only possible ones — they're the same
// numbers, just addressed by state now instead of being the only ones
// that could exist. See multi-state-expansion-architecture-spec.md (the
// project doc) for the full reasoning.
//
// Adding a second state means adding a second profile below, sourced from
// that state's own published EVV/Medicaid guidance the same way TX's was
// (the Texas EVV Policy Handbook, TMHP/HHSC) — never copy another state's
// numbers as a placeholder, since a wrong usage threshold or reason code
// is a compliance error, not a cosmetic one. Kept as reviewed code rather
// than an admin-editable table for the same reason lib/evv-mapping.js's
// original TX_TO_AGGREGATOR_REASON comment gave: a wrong code here is a
// rejected (or worse, silently wrong) EVV visit.

// The 6 EVV data elements every visit must capture, per the federal 21st
// Century Cures Act (Sec. 12006) — every state's EVV program is built
// around these, so this one part of the old lib/data.js export is
// genuinely universal and does NOT move into a per-state profile.
export { CURES_ACT_ELEMENTS } from './data.js';

export const STATE_COMPLIANCE_PROFILES = {
  TX: {
    state: 'TX',
    stateName: 'Texas',
    // Which EVV aggregator vendor Texas HHSC mandates (closed/sole-source
    // model — see the architecture spec). Read by
    // lib/evv-adapters/index.js as the default when a tenant's own
    // organization_evv_credentials.aggregator hasn't been set explicitly.
    defaultAggregator: 'hhaexchange',

    // Texas requires an EVV visit transaction to be corrected/completed
    // within this many days of the date of service before it locks for
    // billing; after that, a Visit Maintenance Unlock Request (VMUR) is
    // required to reopen it.
    visitMaintenanceWindowDays: 95,

    // Minimum quarterly "EVV Usage Score" HHSC requires a provider/FMSA to
    // maintain (the share of visits that did NOT need manual entry or get
    // rejected). Falling below it for consecutive quarters triggers the
    // escalating enforcement ladder below.
    usageThreshold: 80,

    enforcementLadder: [
      { tier: 1, label: '1st non-compliant quarter', consequence: 'Mandatory additional EVV training within 20 business days.' },
      { tier: 2, label: '2nd non-compliant quarter', consequence: 'Corrective Action Plan (CAP) required within 10 business days.' },
      { tier: 3, label: '3rd+ non-compliant quarter (rolling 24 months)', consequence: 'Contract termination may be proposed (or CDS-option removal).' },
    ],

    // Agency-wide EVV Usage Score by fiscal quarter — the trend HHSC's
    // compliance reviews look at. 'Q3 2025' dips below the 80% threshold
    // to demonstrate what a non-compliant quarter looks like in this
    // dashboard. Demo/reference data, same as before this file existed.
    usageHistory: [
      { quarter: 'Q3 2025', score: 76, status: 'training-required' },
      { quarter: 'Q4 2025', score: 83, status: 'compliant' },
      { quarter: 'Q1 2026', score: 91, status: 'compliant' },
      { quarter: 'Q2 2026 (current)', score: 94, status: 'compliant' },
    ],

    // Current (post Aug 2023 consolidation) Texas EVV reason codes — used
    // to document any EVV exception. Replaces the older, more granular
    // pre-2023 code list. Sub-codes under 110 need a bit more
    // specificity; 210 and 600 require a free-text note.
    reasonCodes: {
      '000': { label: 'Overnight visit (system-generated)', requiresNote: false },
      '110A': { label: 'Service Delivery Exception — schedule variance', requiresNote: false },
      '110B': { label: 'Service Delivery Exception — downward adjustment', requiresNote: false },
      '110C': { label: 'Service Delivery Exception — overlapping visits', requiresNote: false },
      '120': { label: 'Eligibility / authorization exception', requiresNote: false },
      '130': { label: 'Disaster', requiresNote: false },
      '210': { label: 'No electronic clock in/out — manual entry', requiresNote: true },
      '210I': { label: 'No electronic clock in/out — emergency', requiresNote: true },
      '310': { label: 'Error during clock in/out', requiresNote: true },
      '600': { label: 'Other', requiresNote: true },
    },

    // Translation from Texas's own reason codes above into the specific
    // aggregator's (HHAeXchange's) wire-format reason/action codes. This
    // is doubly state-and-vendor specific — a different state on the same
    // vendor, or the same state on a different vendor, would need its own
    // table, not a reuse of this one.
    //
    // ⚠ VERIFY BEFORE CERTIFICATION: the published code list available to
    // us at build time was the Illinois specification, since the
    // Texas-specific TX Web Service API guide was not reachable. Confirm
    // every mapping against the real Texas guide during the sandbox test
    // suite rather than trusting this table — a wrong reason code is a
    // rejected visit.
    aggregatorReasonMaps: {
      hhaexchange: {
        reasonCodes: {
          '000': { reasonCode: '222', actionCode: '23' }, // overnight, system-generated
          '110A': { reasonCode: '211', actionCode: '21' }, // schedule variance
          '110B': { reasonCode: '206', actionCode: '21' }, // downward adjustment
          '110C': { reasonCode: '212', actionCode: '23' }, // overlapping visits
          '120': { reasonCode: '222', actionCode: '22' }, // eligibility / authorization
          '130': { reasonCode: '222', actionCode: '25' }, // disaster
          '210': { reasonCode: '210', actionCode: '19' }, // no electronic clock in/out
          '210I': { reasonCode: '218', actionCode: '19' }, // emergency, no clock in/out
          '310': { reasonCode: '219', actionCode: '23' }, // error during clock in/out
          '600': { reasonCode: '222', actionCode: '25' }, // other — requires a note
        },
        // Missed visits use the aggregator's separate missed-visit code set.
        missedVisitDefault: { reasonCode: '601', actionCode: '53' },
      },
    },
  },
};

// Returns the profile for a tenant's state, or null if none is configured
// yet. Deliberately does NOT fall back to another state's numbers — a
// dashboard silently showing Texas's 80%/95-day figures to a tenant in a
// state with different real requirements would be a compliance hazard,
// not a convenience. Callers must handle the null case (see
// app/admin/compliance/page.js) with an honest "not configured yet"
// state rather than guessing.
export function getComplianceProfile(state) {
  return STATE_COMPLIANCE_PROFILES[state] || null;
}

// Convenience accessor for the vendor-specific reason-code translation
// used by an EVV adapter's payload builder (see
// lib/evv-adapters/hhaexchange.js). Returns null if this state/aggregator
// combination has no mapping recorded yet.
export function getAggregatorReasonMap(state, aggregator) {
  const profile = getComplianceProfile(state);
  return profile?.aggregatorReasonMaps?.[aggregator] || null;
}
