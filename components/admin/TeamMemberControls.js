'use client';

import { useActionState, useState } from 'react';
import {
  setTeamMemberActiveAction,
  updateTeamMemberAccessAction,
  resetTeamMemberPasswordAction,
} from '@/actions/team';

const field = 'border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal';
const labelClass = 'flex flex-col gap-1.5 text-[12px] font-display font-bold';
const primaryBtn =
  'bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60';
const quietBtn =
  'border border-[var(--border)] bg-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60';
const dangerBtn =
  'bg-[var(--danger)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[9px] disabled:opacity-60';

function Result({ state }) {
  if (state?.error) {
    return <div className="text-[12px] font-display font-bold text-[var(--danger)] mt-2">{state.error}</div>;
  }
  if (state?.success) {
    return <div className="text-[12px] font-display font-bold text-[var(--success)] mt-2">{state.success}</div>;
  }
  return null;
}

// Per-row account management on /admin/team: change role/location,
// deactivate/reactivate, reset password. The server enforces every rule
// (not yourself, not the last active admin, role/location contract); this
// component only keeps the obvious wrong combinations out of the form.
export default function TeamMemberControls({ member, locations = [] }) {
  const [role, setRole] = useState(member.role);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [accessState, accessAction, accessPending] = useActionState(updateTeamMemberAccessAction, {});
  const [activeState, activeAction, activePending] = useActionState(setTeamMemberActiveAction, {});
  const [resetState, resetAction, resetPending] = useActionState(resetTeamMemberPasswordAction, {});

  const locationRequired = role === 'LOCATION_ADMIN';
  const locationAllowed = role !== 'ADMIN';

  return (
    <details className="mt-2">
      <summary className="text-[12px] font-display font-bold text-[var(--accent)] cursor-pointer">Manage</summary>

      <div className="flex flex-col gap-5 mt-3 p-4 bg-[oklch(98.5%_0.004_85)] border border-[var(--border)] rounded-xl">
        {member.active && (
          <form action={accessAction} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <input type="hidden" name="userId" value={member.id} />
            <label className={labelClass}>
              Role
              <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                <option value="LOCATION_ADMIN">Location admin</option>
                <option value="COORDINATOR">Coordinator</option>
                <option value="ADMIN">Organization admin</option>
              </select>
            </label>
            <label className={labelClass}>
              Location
              <select
                name="locationId"
                className={field}
                required={locationRequired}
                disabled={!locationAllowed}
                defaultValue={member.locationId || ''}
              >
                <option value="">Organization-wide</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={accessPending} className={primaryBtn}>
              {accessPending ? 'Saving…' : 'Save access'}
            </button>
            <div className="col-span-3 -mt-1"><Result state={accessState} /></div>
          </form>
        )}

        <div className="flex flex-wrap gap-6">
          <form action={resetAction}>
            <input type="hidden" name="userId" value={member.id} />
            <button type="submit" disabled={resetPending || !member.active} className={quietBtn}>
              {resetPending ? 'Resetting…' : 'Reset password'}
            </button>
            <Result state={resetState} />
            {resetState?.temporaryPassword && (
              <div className="mt-2 font-mono text-[15px] tracking-wide bg-white border border-[var(--border)] rounded-lg px-3 py-2 select-all inline-block">
                {resetState.temporaryPassword}
              </div>
            )}
          </form>

          <form action={activeAction}>
            <input type="hidden" name="userId" value={member.id} />
            <input type="hidden" name="active" value={member.active ? 'false' : 'true'} />
            {member.active && !confirmDeactivate ? (
              <button type="button" onClick={() => setConfirmDeactivate(true)} className={quietBtn}>
                Deactivate…
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button type="submit" disabled={activePending} className={member.active ? dangerBtn : primaryBtn}>
                  {activePending ? 'Saving…' : member.active ? 'Yes, deactivate and sign out' : 'Reactivate'}
                </button>
                {member.active && (
                  <button type="button" onClick={() => setConfirmDeactivate(false)} className="text-[12px] font-display font-bold text-[var(--muted)]">
                    Cancel
                  </button>
                )}
              </div>
            )}
            <Result state={activeState} />
          </form>
        </div>
      </div>
    </details>
  );
}
