import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getClient, getServiceAuthorizations, getOrientationsForClient, getCaregiver } from '@/lib/queries';
import { createAuthorizationAction } from '@/actions/care-plans';
import { createOrientationAction } from '@/actions/orientations';
import ClientEvvIdentityForm from '@/components/admin/ClientEvvIdentityForm';
import ClientHomeLocationForm from '@/components/admin/ClientHomeLocationForm';
import { mapLink } from '@/lib/geo';

const STATUS_STYLES = {
  approved: 'bg-[oklch(94%_0.06_155)] text-[oklch(38%_0.1_155)]',
  pending: 'bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]',
  denied: 'bg-[oklch(93%_0.06_25)] text-[var(--danger)]',
  expired: 'bg-[oklch(94%_0.006_85)] text-[var(--muted)]',
};

function fieldRow(label, value) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="text-[13px] mt-0.5">{value}</div>
    </div>
  );
}

export default async function ClientCarePlanPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const [client, authorizations, orientations] = await Promise.all([
    getClient(session.organizationId, id, session.locationId),
    getServiceAuthorizations(session.organizationId, id),
    getOrientationsForClient(session.organizationId, id),
  ]);
  const assignedCaregiver = client?.assignedCaregiverId
    ? await getCaregiver(session.organizationId, client.assignedCaregiverId)
    : null;

  if (!client) {
    return (
      <div className="text-[13px] text-[var(--muted)]">
        Client not found. <Link href="/admin/clients" className="text-[var(--accent)] font-display font-bold">Back to clients</Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/clients"
        className="flex items-center gap-1.5 text-[12.5px] font-display font-bold text-[var(--muted)] mb-3"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to clients
      </Link>

      <h1 className="font-display font-extrabold text-[24px]">{client.name} — Care Plan</h1>
      <p className="text-[13.5px] text-[var(--muted)] mt-1">
        Payer service authorizations and the tasks each one covers — this is the source of truth for what a
        caregiver is authorized to do in this client&rsquo;s home, mirroring the payer&rsquo;s own authorization
        notice.
      </p>

      <div
        id="evv-identity"
        className={
          'bg-[var(--surface)] border rounded-2xl p-6 mt-6 ' +
          (client.medicaidId ? 'border-[var(--border)]' : 'border-[oklch(80%_0.1_60)]')
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display font-extrabold text-[15px]">EVV identity</div>
            <div className="text-[12.5px] text-[var(--muted)] mt-0.5">
              What the state EVV aggregator uses to match this client&rsquo;s visits to their Medicaid record.
            </div>
          </div>
          {!client.medicaidId && (
            <span className="text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 bg-[oklch(94%_0.05_85)] text-[oklch(45%_0.1_75)]">
              Medicaid ID missing
            </span>
          )}
        </div>
        {!client.medicaidId && (
          <p className="text-[12.5px] text-[oklch(45%_0.1_75)] mt-3">
            Visits for this client can&rsquo;t be sent to the EVV aggregator until a Medicaid ID is on file.
          </p>
        )}
        <ClientEvvIdentityForm client={client} />
        <ClientHomeLocationForm
          clientId={client.id}
          home={
            client.homeLat !== null && client.homeLat !== undefined
              ? {
                  source: client.homeLocationSource,
                  setAt: client.homeLocationSetAt
                    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(client.homeLocationSetAt))
                    : null,
                  setBy: client.homeLocationSetBy,
                  mapHref: mapLink(client.homeLat, client.homeLng),
                }
              : null
          }
        />
      </div>

      <div className="flex flex-col gap-4 mt-6">
        {authorizations.length === 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 text-[13px] text-[var(--muted)]">
            No service authorization on file yet for this client. Add one below from the payer&rsquo;s
            authorization notice (fax, portal print-out, or letter).
          </div>
        )}

        {authorizations.map((auth) => (
          <div key={auth.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="font-display font-extrabold text-[15px]">
                  {auth.serviceCode} — {auth.serviceDescription}
                </div>
                <div className="text-[12.5px] text-[var(--muted)] mt-0.5">{auth.payer}</div>
              </div>
              <span
                className={
                  'text-[11px] font-display font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ' +
                  (STATUS_STYLES[auth.status] || STATUS_STYLES.pending)
                }
              >
                {auth.status}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-4 pb-4 border-b border-[oklch(93%_0.01_85)]">
              {fieldRow('Case ID', auth.caseId)}
              {fieldRow('Reference #', auth.referenceNumber)}
              {fieldRow('Modifier', auth.modifierCodes)}
              {fieldRow(
                'Units',
                auth.totalUnitsPerWeek
                  ? `${auth.totalUnitsPerWeek} / ${auth.frequency?.toLowerCase() || 'week'} (${auth.unitMinutes}-min units)`
                  : null
              )}
              {fieldRow('Hours / week', auth.totalHoursPerWeek)}
              {fieldRow(
                'Rate / unit',
                auth.ratePerUnit != null ? `$${auth.ratePerUnit.toFixed(2)}` : null
              )}
              {fieldRow('Effective', `${auth.startDate} – ${auth.endDate}`)}
              {fieldRow('Diagnosis', auth.diagnosisCode ? `${auth.diagnosisCode} — ${auth.diagnosisDescription || ''}` : null)}
            </div>

            {auth.purchasedTasks.length > 0 && (
              <div className="pt-4">
                <div className="text-[10.5px] font-display font-bold uppercase tracking-wide text-[var(--muted)] mb-2">
                  Purchased tasks
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {auth.purchasedTasks.map((task) => (
                    <span
                      key={task}
                      className="text-[12px] px-2.5 py-1 rounded-full bg-[oklch(96%_0.006_85)] border border-[var(--border)]"
                    >
                      {task}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {auth.notes && <p className="text-[12.5px] text-[var(--muted)] mt-4">{auth.notes}</p>}
          </div>
        ))}
      </div>

      {/* Attendant Orientation — required per caregiver-client pairing under
          26 TAC §97, generated pre-filled from this client's authorization
          and schedule rather than hand-copied onto a paper form. */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display font-extrabold text-[14.5px]">Attendant Orientation</div>
            <p className="text-[12.5px] text-[var(--muted)] mt-1">
              Required each time a caregiver is assigned to this client — generated pre-filled from the
              authorization above and the current schedule.
            </p>
          </div>
          {assignedCaregiver ? (
            <form action={createOrientationAction} className="shrink-0 flex items-center gap-2">
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="caregiverId" value={assignedCaregiver.id} />
              <select
                name="orientationType"
                defaultValue="initial"
                className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12.5px] font-display font-semibold bg-[oklch(99%_0.004_85)]"
              >
                <option value="initial">Initial</option>
                <option value="annual">Annual</option>
                <option value="other">Other</option>
              </select>
              <button
                type="submit"
                className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12.5px] px-4 py-2 rounded-[10px] whitespace-nowrap"
              >
                Generate
              </button>
            </form>
          ) : (
            <span className="text-[12px] text-[oklch(45%_0.11_55)] font-display font-bold shrink-0">
              Assign a caregiver first
            </span>
          )}
        </div>

        {orientations.length > 0 && (
          <div className="mt-4 border-t border-[oklch(93%_0.01_85)] pt-3 flex flex-col gap-2">
            {orientations.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-display font-bold text-[13.5px]">{o.caregiverName}</div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {o.orientationType} ·{' '}
                    {o.status === 'completed'
                      ? `completed${o.orientedOn ? ` ${o.orientedOn}` : ''}`
                      : 'draft — not yet delivered'}
                  </div>
                </div>
                <Link
                  href={`/admin/orientations/${o.id}`}
                  className="text-[12px] font-display font-bold text-[var(--accent)] whitespace-nowrap"
                >
                  Open form →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 mt-6 group">
        <summary className="font-display font-extrabold text-[14.5px] cursor-pointer">
          + Add service authorization
        </summary>

        <form action={createAuthorizationAction} className="grid grid-cols-2 gap-4 mt-5">
          <input type="hidden" name="clientId" value={client.id} />

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Payer
            <input name="payer" required defaultValue={client.payer} className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Status
            <select name="status" defaultValue="approved" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal">
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="denied">Denied</option>
              <option value="expired">Expired</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Service code
            <input name="serviceCode" required placeholder="S5125" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Service description
            <input name="serviceDescription" required placeholder="Attendant Care Services; Per 15 Minutes" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Case ID
            <input name="caseId" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Reference #
            <input name="referenceNumber" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Modifier code(s)
            <input name="modifierCodes" placeholder="U5" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Unit length (minutes)
            <input name="unitMinutes" type="number" defaultValue={15} className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Rate per unit ($)
            <input name="ratePerUnit" type="number" step="0.01" min="0" placeholder="25.00" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
            <span className="text-[11px] font-body font-normal text-[var(--muted)]">
              Drives billed revenue. Leave blank if the payer rate isn&rsquo;t confirmed — lines
              then show as unrated rather than $0.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Total hours / week
            <input name="totalHoursPerWeek" type="number" step="0.1" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Total units / week
            <input name="totalUnitsPerWeek" type="number" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Start date
            <input name="startDate" type="date" required className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            End date
            <input name="endDate" type="date" required className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Diagnosis code
            <input name="diagnosisCode" placeholder="I10" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold">
            Diagnosis description
            <input name="diagnosisDescription" className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Purchased tasks (comma-separated, as they appear on the authorization)
            <textarea
              name="purchasedTasks"
              rows={2}
              placeholder="Bathing, Dressing, Exercise, Grooming (Shaving, Oral care, Nail Care), Toileting, Transfer, Walking, Meal Prep, Shopping, Assistance with Medications"
              className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] font-display font-bold col-span-2">
            Notes
            <textarea name="notes" rows={2} className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-body font-normal" />
          </label>

          <div className="col-span-2">
            <button
              type="submit"
              className="bg-[var(--accent-strong)] text-white font-display font-bold text-[13px] px-5 py-2.5 rounded-[10px]"
            >
              Save authorization
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
