// Visit-location helpers (added 2026-09-24). Pure functions, no imports —
// safe in server and client components and in QA.
//
// Location categories follow Vesta's "Community Location" guide: the
// caregiver picks one at clock-in and again at clock-out.

export const VISIT_LOCATIONS = [
  { value: 'member_home', label: "Client's home" },
  { value: 'family_home', label: 'Family home' },
  { value: 'neighbor_home', label: "Neighbor's home" },
  { value: 'community', label: 'Community location' },
  { value: 'other', label: 'Other' },
];

export const DEFAULT_HOME_RADIUS_FEET = 250;

export function isVisitLocation(value) {
  return VISIT_LOCATIONS.some((l) => l.value === value);
}

export function visitLocationLabel(value) {
  return VISIT_LOCATIONS.find((l) => l.value === value)?.label || null;
}

export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const EARTH_RADIUS_FEET = 20902231; // mean Earth radius, 6371.0088 km

// Great-circle distance in feet (haversine). Accurate to well under a foot
// at the few-hundred-foot scale EVV cares about.
export function distanceFeet(lat1, lng1, lat2, lng2) {
  if (!isValidLatLng(lat1, lng1) || !isValidLatLng(lat2, lng2)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_FEET * Math.asin(Math.min(1, Math.sqrt(a)));
}

// "180 ft" / "2.4 mi" for display.
export function formatDistance(feet) {
  if (feet === null || feet === undefined || !Number.isFinite(Number(feet))) return null;
  const f = Number(feet);
  if (f < 1000) return `${Math.round(f)} ft`;
  return `${(f / 5280).toFixed(f < 52800 ? 1 : 0)} mi`;
}

export function mapLink(lat, lng) {
  if (!isValidLatLng(Number(lat), Number(lng))) return null;
  return `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

// Parses what staff paste in: "26.075175, -97.473486" or a Google Maps URL
// containing "@lat,lng" or "q=lat,lng". Returns { lat, lng } or null.
export function parseLatLng(text) {
  const s = String(text || '').trim();
  const m = s.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}
