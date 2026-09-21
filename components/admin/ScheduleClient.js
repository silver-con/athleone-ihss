'use client';

import { useState, useActionState } from 'react';
import Link from 'next/link';
import { WEEK_DAYS, TODAY_KEY, REASON_CODES } from '@/lib/data';
import { visitStatusInfo, VISIT_STATUS_ORDER, caregiverStatusInfo } from '@/lib/styles';
import { createVisitAction } from '@/actions/schedule';

const GRID_COLS = '150px repeat(7, minmax(120px, 1fr))';
const GRID_MIN_WIDTH = '1050px';

function clientName(clients, id) {
  return clients.find((c) => c.id === id)?.name || 'Unknown client';
}

export default function ScheduleClient({ caregivers, clients, visits }) {
  const [selectedId, setSelectedId] = useState(null);

  const selected = visits.find((v) => v.id === selectedId) || null;

  const onLeave = caregivers.filter((cg) => cg.status === 'on-leave');
  const missedThisWeek = visits.filter((v) => v.status === 'missed' && !v.resolved);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">Schedule</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">
            Week of Sep 14–20 · caregiver visits across every active client
          </p>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-[var(--muted)] pt-1.5 shrink-0">
          {VISIT_STATUS_ORDER.map((key) => {
            const info = visitStatusInfo(key);
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: info.dot }} />
                {info.label}
              </div>
            );
          })}
        </div>
      </div>

      {(onLeave.length > 0 || missedThisWeek.length > 0) && (
        <div className="mt-5 bg-[var(--danger-soft)] border border-[oklch(85%_0.08_25)] rounded-2xl px-5 py-4">
          <div className="font-display font-extrabold text-[13.5px] text-[var(--danger)] mb-2">
            Coverage &amp; follow-up needed
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] text-[oklch(35%_0.1_25)]">
            {onLeave.map((cg) => (
              <div key={cg.id}>
                <span className="font-display font-bold">{cg.name}</span> is on leave this week — no
                visits assigned. Reassign their caseload or arrange coverage.
              </div>
            ))}
            {missedThisWeek.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-display font-bold">{clientName(clients, v.clientId)}</span>&rsquo;s{' '}
                  {WEEK_DAYS.find((d) => d.key === v.day)?.label} {v.start}–{v.end} visit was missed
                  ({caregivers.find((c) => c.id === v.caregiverId)?.name}).
                </div>
                <Link href="/admin/evv" className="font-display font-bold underline whitespace-nowrap">
                  Review →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto mt-6">
        <div
          className="grid text-[11px] font-display font-bold uppercase tracking-wide text-[var(--muted)] border-b border-[var(--border)]"
          style={{ gridTemplateColumns: GRID_COLS, minWidth: GRID_MIN_WIDTH }}
        >
          <div className="px-4 py-3">Caregiver</div>
          {WEEK_DAYS.map((d) => (
            <div
              key={d.key}
              className={
                'px-2 py-3 text-center rounded-t-[10px] ' +
                (d.key === TODAY_KEY ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : '')
              }
            >
              <div>{d.label}</div>
              <div className="normal-case font-normal text-[10.5px] mt-0.5 tracking-normal">{d.date}</div>
            </div>
          ))}
        </div>

        {caregivers.map((cg) => {
          const cgVisits = visits.filter((v) => v.caregiverId === cg.id);
          const status = caregiverStatusInfo(cg.status);

          if (cg.status === 'on-leave') {
            return (
              <div
                key={cg.id}
                className="grid items-center border-b border-[oklch(93%_0.01_85)] last:border-none"
                style={{ gridTemplateColumns: GRID_COLS, minWidth: GRID_MIN_WIDTH }}
              >
                <div className="px-4 py-4">
                  <div className="font-display font-bold text-[13px]">{cg.name}</div>
                  <span className={'inline-block mt-1 text-[10.5px] font-display font-bold px-2 py-0.5 rounded-full ' + status.className}>
                    {status.label}
                  </span>
                </div>
                <div className="col-span-7 px-3 py-4 text-[12.5px] text-[var(--muted)] italic">
                  On leave — no visits scheduled this week
                </div>
              </div>
            );
          }

          return (
            <div
              key={cg.id}
              className="grid items-stretch border-b border-[oklch(93%_0.01_85)] last:border-none"
              style={{ gridTemplateColumns: GRID_COLS, minWidth: GRID_MIN_WIDTH }}
            >
              <div className="px-4 py-4">
                <div className="font-display font-bold text-[13px]">{cg.name}</div>
                <div className="text-[11.5px] text-[var(--muted)] mt-0.5">{cg.role}</div>
              </div>
              {WEEK_DAYS.map((d) => {
                const dayVisits = cgVisits.filter((v) => v.day === d.key);
                return (
                  <div
                    key={d.key}
                    className={
                      'px-1.5 py-2.5 flex flex-col gap-1.5 border-l border-[oklch(95%_0.006_85)] ' +
                      (d.key === TODAY_KEY ? 'bg-[oklch(98.5%_0.01_175)]' : '')
                    }
                  >
                    {dayVisits.map((v) => {
                      const info = visitStatusInfo(v.status);
                      const isSelected = v.id === selectedId;
                      return (
                        <button
                          key={v.id}
                          onClick={() => setSelectedId(v.id)}
                          className={
                            'text-left rounded-[8px] px-2 py-1.5 border cursor-pointer w-full ' +
                            (isSelected
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-[oklch(92%_0.008_85)] bg-[oklch(99%_0.004_85)] hover:border-[oklch(80%_0.02_85)]')
                          }
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.dot }} />
                            <span className="font-display font-bold text-[11.5px] truncate">
                              {clientName(clients, v.clientId)}
                            </span>
                          </div>
                          <div className="text-[10.5px] text-[var(--muted)] mt-0.5">{v.start}</div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <ScheduleVisitForm caregivers={caregivers} clients={clients} />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-4">
        {!selected ? (
          <div className="text-[13px] text-[var(--muted)]">
            Click any visit on the schedule above to see its details, including EVV clock-in/out data
            once a visit has started.
          </div>
        ) : (
          <VisitDetail visit={selected} caregivers={caregivers} clients={clients} />
        )}
      </div>
    </div>
  );
}

const fieldClass =
  'border border-[oklch(85%_0.01_85)] rounded-[9px] px-3 py-2 text-[13px] bg-[oklch(99%_0.004_85)] focus:outline-2 focus:outline-[oklch(80%_0.05_175)] focus:border-[oklch(60%_0.08_175)]';
const labelClass = 'flex flex-col gap-1.5 text-[11.5px] font-display font-bold text-[oklch(45%_0.02_80)]';

function ScheduleVisitForm({ caregivers, clients }) {
  const [state, formAction, pending] = useActionState(createVisitAction, { error: null, success: null });
  const schedulable = caregivers.filter((cg) => cg.status !== 'on-leave');

  return (
    <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
      <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
        + Schedule a visit
      </summary>

      {schedulable.length === 0 || clients.length === 0 ? (
        <p className="text-[12.5px] text-[var(--muted)] mt-3">
          {schedulable.length === 0
            ? 'No caregiver available to schedule — every caregiver here is on leave.'
            : 'No client to schedule for yet — complete an intake first.'}
        </p>
      ) : (
        <form action={formAction} className="grid grid-cols-2 gap-4 mt-4">
          <label className={labelClass}>
            Caregiver
            <select name="caregiverId" required defaultValue="" className={fieldClass}>
              <option value="" disabled>Pick a caregiver…</option>
              {schedulable.map((cg) => (
                <option key={cg.id} value={cg.id}>{cg.name}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Client
            <select name="clientId" required defaultValue="" className={fieldClass}>
              <option value="" disabled>Pick a client…</option>
              {clients.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Day (current schedule week)
            <select name="day" required defaultValue={TODAY_KEY} className={fieldClass}>
              {WEEK_DAYS.map((d) => (
                <option key={d.key} value={d.key}>{d.label} {d.date}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClass}>
              Start time
              <input name="startTime" required placeholder="9:00 AM" className={fieldClass} />
            </label>
            <label className={labelClass}>
              End time
              <input name="endTime" required placeholder="12:00 PM" className={fieldClass} />
            </label>
          </div>

          {state?.error && (
            <div className="col-span-2 text-[12.5px] font-display font-bold text-[var(--danger)] bg-[oklch(96%_0.03_25)] border border-[oklch(85%_0.08_25)] rounded-xl px-3.5 py-2.5">
              {state.error}
            </div>
          )}
          {state?.success && (
            <div className="col-span-2 text-[12.5px] font-display font-bold text-[var(--success)] bg-[var(--success-soft)] rounded-xl px-3.5 py-2.5">
              {state.success}
            </div>
          )}

          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="bg-[var(--accent-strong)] text-white rounded-[9px] px-4 py-2.5 font-display font-bold text-[12.5px] disabled:opacity-60"
            >
              {pending ? 'Scheduling…' : 'Schedule visit'}
            </button>
          </div>
        </form>
      )}
    </details>
  );
}

function VisitDetail({ visit, caregivers, clients }) {
  const info = visitStatusInfo(visit.status);
  const caregiver = caregivers.find((c) => c.id === visit.caregiverId);
  const day = WEEK_DAYS.find((d) => d.key === visit.day);

  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-8">
      <div>
        <span className={'inline-flex items-center gap-1.5 text-[11px] font-display font-bold px-2.5 py-1 rounded-full ' + info.className}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: info.dot }} />
          {info.label}
        </span>

        <div className="font-display font-extrabold text-[18px] mt-3">{clientName(clients, visit.clientId)}</div>
        <div className="text-[13px] text-[var(--muted)] mt-0.5">
          {caregiver?.name} · {day?.label} {day?.date}, {visit.start}–{visit.end}
        </div>
      </div>

      <div>
        <div className="font-display font-extrabold text-[12.5px] uppercase tracking-wide text-[var(--muted)] mb-2.5">
          EVV — Electronic Visit Verification
        </div>

        {!visit.evv ? (
          <p className="text-[13px] text-[var(--muted)]">
            This visit hasn&rsquo;t started yet — clock-in data will appear here once the caregiver checks in.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Clock-in</span>
              <span className="font-display font-bold">{visit.evv.clockIn || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Clock-out</span>
              <span className="font-display font-bold">{visit.evv.clockOut || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Method</span>
              <span className="font-display font-bold text-right">{visit.evv.method || '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--muted)]">Verified</span>
              <span
                className={
                  'text-[11px] font-display font-bold px-2 py-0.5 rounded-full ' +
                  (visit.evv.verified
                    ? 'bg-[var(--success-soft)] text-[var(--success)]'
                    : 'bg-[oklch(95%_0.006_85)] text-[var(--muted)]')
                }
              >
                {visit.evv.verified ? 'Yes' : 'Pending'}
              </span>
            </div>

            {visit.evv.exception && (
              <div className="col-span-2 mt-1 bg-[var(--danger-soft)] text-[var(--danger)] rounded-[10px] px-3 py-2.5 text-[12.5px] font-display font-semibold">
                Code {visit.evv.exception} — {REASON_CODES[visit.evv.exception]?.label || 'Unknown reason code'}
              </div>
            )}
          </div>
        )}

        <Link
          href="/admin/evv"
          className="inline-block mt-4 text-[12.5px] font-display font-bold text-[var(--accent)]"
        >
          Open full EVV compliance log →
        </Link>
      </div>
    </div>
  );
}
