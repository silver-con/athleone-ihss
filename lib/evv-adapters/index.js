// EvvAdapter registry — one module per supported EVV aggregator vendor.
//
// Formalizes the shape lib/hhaexchange.js already had (it was written
// before Hearth needed to support more than one vendor, so it never
// declared an interface explicitly). Every adapter registered here must
// export:
//   upsertCaregiver(credentials, caregiver)        -> vendor response
//   submitVisits(credentials, payloads)             -> { transactionId }
//   updateVisit(credentials, evvmsId, payload)      -> { transactionId }
//   deleteVisit(credentials, evvmsId)               -> { transactionId }
//   getTransactionStatus(credentials, transactionId) -> { status, evvmsId?, message? }
//   testConnection(credentials)                     -> { ok, error? }
//   clearTokenCache(organizationId)                 -> void
//
// lib/evv-sync.js and actions/evv.js resolve an adapter by
// organization_evv_credentials.aggregator (see db/schema.sql) through
// getEvvAdapter() below rather than importing a vendor module directly —
// that's what makes adding Sandata, AuthentiCare, Tellus/Netsmart, or
// CareBridge later a new module + one line here, not a rewrite of the
// queue/polling logic. See multi-state-expansion-architecture-spec.md
// (the project doc) for the full reasoning.
//
// Texas is HHAeXchange-only (a closed/sole-source state EVV model), which
// is why this is the only adapter actually implemented so far — the other
// vendors are named in the spec but deliberately not stubbed out here
// ahead of a real second state needing them.
import * as hhaexchange from '@/lib/hhaexchange';

const ADAPTERS = {
  hhaexchange,
};

export function getEvvAdapter(aggregator) {
  const adapter = ADAPTERS[aggregator];
  if (!adapter) {
    throw new Error(
      `No EVV adapter registered for aggregator "${aggregator}". Registered: ${Object.keys(ADAPTERS).join(', ') || '(none)'}.`
    );
  }
  return adapter;
}

export function listEvvAdapters() {
  return Object.keys(ADAPTERS);
}
