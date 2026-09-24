'use client';

import { useTransition } from 'react';
import { clockInAction, clockOutAction } from '@/actions/caregiver';

// Best-effort device geolocation, captured immediately before a clock
// event. Never blocks or rejects — a caregiver who denies location access,
// is indoors with no fix, or is on a browser without the API at all must
// still be able to clock in/out (EVV requires the visit to happen, not
// that it be perfectly located). A short timeout keeps a stalled GPS fix
// from stalling the button; failures resolve to null and the visit is
// simply recorded without coordinates.
function captureGeo() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

export function ClockInButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        startTransition(async () => {
          const geo = await captureGeo();
          await clockInAction(visitId, geo);
        });
      }}
      disabled={pending}
      className={className}
    >
      {pending ? 'Clocking in…' : children || 'Clock In'}
    </button>
  );
}

export function ClockOutButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        startTransition(async () => {
          const geo = await captureGeo();
          await clockOutAction(visitId, geo);
        });
      }}
      disabled={pending}
      className={className}
    >
      {pending ? 'Clocking out…' : children || 'Clock Out'}
    </button>
  );
}
