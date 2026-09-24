'use client';

import { useState, useTransition } from 'react';
import { clockInAction, clockOutAction } from '@/actions/caregiver';
import { VISIT_LOCATIONS } from '@/lib/geo';

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

// "Where are you?" — Vesta's location categories, asked at clock-in and
// again at clock-out. Defaults to the client's home, the overwhelmingly
// common case; the caregiver changes it when the service is elsewhere
// (a doctor's visit, the grocery store, a family member's house).
function WherePicker({ value, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between gap-3 mb-2.5 text-[12.5px]">
      <span className="font-display font-bold text-[var(--muted)]">Where are you?</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[13px] bg-white min-w-0"
      >
        {VISIT_LOCATIONS.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ClockInButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [where, setWhere] = useState('member_home');
  return (
    <>
      <WherePicker value={where} onChange={setWhere} disabled={pending} />
      <button
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const geo = await captureGeo();
            const result = await clockInAction(visitId, geo, where);
            if (result?.error) setError(result.error);
          });
        }}
        disabled={pending}
        className={className}
      >
        {pending ? 'Clocking in…' : children || 'Clock In'}
      </button>
      {error && (
        <p role="alert" className="text-[12.5px] font-display font-bold text-[var(--danger)] mt-2">
          {error}
        </p>
      )}
    </>
  );
}

export function ClockOutButton({ visitId, className, children }) {
  const [pending, startTransition] = useTransition();
  const [where, setWhere] = useState('member_home');
  return (
    <>
      <WherePicker value={where} onChange={setWhere} disabled={pending} />
      <button
        onClick={() => {
          startTransition(async () => {
            const geo = await captureGeo();
            await clockOutAction(visitId, geo, where);
          });
        }}
        disabled={pending}
        className={className}
      >
        {pending ? 'Clocking out…' : children || 'Clock Out'}
      </button>
    </>
  );
}
