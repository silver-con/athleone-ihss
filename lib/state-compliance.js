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

    // Texas HHSC EVV reason codes, as published in "EVV Reason Codes
    // Effective Aug. 1, 2023" (TMHP, HHSC EVV Business Rules for
    // Proprietary Systems, Appendix A). Replaced Hearth's earlier
    // approximated list on 2026-09-23. HHSC's EVV Policy Handbook §10000
    // (Rev. 25-1, Mar 12 2025) still points to this code set and says free
    // text is required ONLY for 210 I (Emergency) and 600 (Other).
    //
    // ⚠ HHSC also published "EVV Reason Codes Effective Oct. 1, 2023"; it
    // could not be fetched when this was written (hhs.texas.gov blocks
    // automated access). Diff it against this table before go-live.
    //
    // Keys are the code the office selects: the three-digit number plus the
    // sub-code letter ('210A'). `group` is the three-digit number.
    // `selectable: false` entries are never offered in the visit-
    // maintenance form: 000 is system-generated only, and the bare group
    // numbers ('110', '210', …) are LEGACY keys kept only so visits
    // recorded before sub-codes existed in Hearth still display a label.
    reasonCodes: {
      '000': { group: '000', label: 'Overnight — system-generated to split an overnight visit', requiresNote: false, selectable: false },

      '110A': { group: '110', label: 'Service Delivery Exception — service delivery differs from schedule', requiresNote: false },
      '110B': { group: '110', label: 'Service Delivery Exception — downward adjustment of bill hours', requiresNote: false },
      '110C': { group: '110', label: 'Service Delivery Exception — fill-in service provider', requiresNote: false },
      '110D': { group: '110', label: 'Service Delivery Exception — allowable overlapping visits', requiresNote: false },

      '120A': { group: '120', label: 'Eligibility / Authorization Exception — services provided without eligibility', requiresNote: false },
      '120B': { group: '120', label: 'Eligibility / Authorization Exception — services provided without authorization', requiresNote: false },

      '130A': { group: '130', label: 'Disaster — flood', requiresNote: false },
      '130B': { group: '130', label: 'Disaster — hurricane', requiresNote: false },
      '130C': { group: '130', label: 'Disaster — ice/snow storm', requiresNote: false },
      '130D': { group: '130', label: 'Disaster — tornado', requiresNote: false },
      '130E': { group: '130', label: 'Disaster — wildfire', requiresNote: false },
      '130F': { group: '130', label: 'Disaster — public health disaster', requiresNote: false },

      '210A': { group: '210', label: 'No Electronic Clock In/Out — failure to clock in, clock out or both', requiresNote: false, allowsManualTime: true },
      '210B': { group: '210', label: 'No Electronic Clock In/Out — mobile device not available', requiresNote: false, allowsManualTime: true },
      '210C': { group: '210', label: 'No Electronic Clock In/Out — landline phone not available', requiresNote: false, allowsManualTime: true },
      '210D': { group: '210', label: 'No Electronic Clock In/Out — landline phone not registered in EVV system', requiresNote: false, allowsManualTime: true },
      '210E': { group: '210', label: 'No Electronic Clock In/Out — alternative device value incorrect', requiresNote: false, allowsManualTime: true },
      '210F': { group: '210', label: 'No Electronic Clock In/Out — alternative device not available', requiresNote: false, allowsManualTime: true },
      '210G': { group: '210', label: 'No Electronic Clock In/Out — alternative device value expired', requiresNote: false, allowsManualTime: true },
      '210H': { group: '210', label: 'No Electronic Clock In/Out — authorized services provided in the community', requiresNote: false, allowsManualTime: true },
      '210I': { group: '210', label: 'No Electronic Clock In/Out — emergency', requiresNote: true, allowsManualTime: true, noteHint: 'Describe the nature of the emergency.' },
      '210J': { group: '210', label: 'No Electronic Clock In/Out — EVV system down', requiresNote: false, allowsManualTime: true },

      '310A': { group: '310', label: 'Error During Clock In/Out — multiple calls for one visit', requiresNote: false },
      '310B': { group: '310', label: 'Error During Clock In/Out — incorrect service selected', requiresNote: false },
      '310C': { group: '310', label: 'Error During Clock In/Out — incorrect EVV employee ID', requiresNote: false },
      '310D': { group: '310', label: 'Error During Clock In/Out — incorrect EVV member ID', requiresNote: false },
      '310E': { group: '310', label: 'Error During Clock In/Out — incorrect service delivery location', requiresNote: false },

      '600': { group: '600', label: 'Other — no other reason code applies', requiresNote: true, noteHint: 'Explain what happened; HHSC requires free text for 600.' },

      // Legacy keys (see above) — display only.
      '110': { group: '110', label: 'Service Delivery Exception (no sub-code recorded)', requiresNote: false, selectable: false },
      '120': { group: '120', label: 'Eligibility / Authorization Exception (no sub-code recorded)', requiresNote: false, selectable: false },
      '130': { group: '130', label: 'Disaster (no sub-code recorded)', requiresNote: false, selectable: false },
      '210': { group: '210', label: 'No Electronic Clock In/Out (no sub-code recorded)', requiresNote: false, selectable: false },
      '310': { group: '310', label: 'Error During Clock In/Out (no sub-code recorded)', requiresNote: false, selectable: false },
    },

    // Group headings for the reason-code picker, in HHSC's order.
    reasonCodeGroups: [
      { group: '110', label: '110 — Service Delivery Exception' },
      { group: '120', label: '120 — Eligibility or Service Authorization Exception' },
      { group: '130', label: '130 — Disaster' },
      { group: '210', label: '210 — No Electronic Clock In or Clock Out' },
      { group: '310', label: '310 — Error During Clock In or Clock Out' },
      { group: '600', label: '600 — Other' },
    ],

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
          // 2026-09-23: HHSC's 110 C is "fill-in service provider" and
          // 110 D is "allowable overlapping visits". The overlapping-visit
          // mapping that was keyed '110C' moved to '110D'; 110C now falls
          // back to the 110 group default below. Every value in this
          // table is still unverified (see the warning above).
          '110D': { reasonCode: '212', actionCode: '23' }, // allowable overlapping visits
          '110': { reasonCode: '211', actionCode: '21' }, // group default
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

// Looks up a reason code's display info, falling back from a sub-code
// ('210A') to its group ('210') so nothing ever shows as "unknown" just
// because one table has more detail than another.
export function getReasonCodeInfo(profile, code) {
  if (!profile || !code) return null;
  const codes = profile.reasonCodes || {};
  return codes[code] || codes[String(code).slice(0, 3)] || null;
}

// The codes an office user may pick in the visit-maintenance form,
// grouped in HHSC's order: [{ group, label, codes: [{ code, ...info }] }].
export function selectableReasonCodes(profile) {
  if (!profile) return [];
  const codes = profile.reasonCodes || {};
  return (profile.reasonCodeGroups || []).map((g) => ({
    ...g,
    codes: Object.entries(codes)
      .filter(([, info]) => info.group === g.group && info.selectable !== false)
      .map(([code, info]) => ({ code, ...info })),
  }));
}

// Same fallback for the aggregator's wire-format translation.
export function mapReasonCodeForAggregator(reasonMap, code) {
  if (!reasonMap || !code) return null;
  const codes = reasonMap.reasonCodes || {};
  return codes[code] || codes[String(code).slice(0, 3)] || null;
}
