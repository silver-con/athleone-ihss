'use client';

import { useTransition } from 'react';
import { setCaregiverLocationAction, setClientLocationAction } from '@/actions/locations';

// Moves an existing caregiver or client between locations, straight from
// the roster. Exists because every row predating the locations feature has
// no location, and locations are now required for new records — so without
// this those rows would sit permanently outside every location and outside
// the franchise revenue rollup. Unassigned is styled as a warning rather
// than a neutral choice for exactly that reason.
export default function LocationAssignSelect({ kind, recordId, locationId, locations }) {
  const [pending, startTransition] = useTransition();
  const action = kind === 'client' ? setClientLocationAction : setCaregiverLocationAction;

  return (
    <select
      defaultValue={locationId || ''}
      disabled={pending}
      aria-label="Location"
      onChange={(e) => startTransition(() => action(recordId, e.target.value))}
      className={
        'border rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-display font-semibold bg-[oklch(99%_0.004_85)] disabled:opacity-60 w-full ' +
        (locationId
          ? 'border-[oklch(85%_0.01_85)]'
          : 'border-[oklch(75%_0.1_55)] text-[oklch(45%_0.11_55)]')
      }
    >
      <option value="">No location</option>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  );
}
