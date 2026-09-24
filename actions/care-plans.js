'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/actions/auth';
import * as db from '@/lib/queries';
import { parseLatLng } from '@/lib/geo';

// Turns the free-text "Purchased Tasks" line from a payer authorization
// (e.g. "BATHING, Dressing, Exercise, Grooming (Shaving, Oral care, Nail
// Care), Toileting") into a clean array — same comma-separated shape
// MCOs actually send, so office staff can paste it straight off a fax
// or portal screen rather than re-typing it into separate fields.
function parseTaskList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createAuthorizationAction(formData) {
  const session = await requirePermission('admin.carePlans.manage');
  const clientId = String(formData.get('clientId') || '').trim();

  const serviceCode = String(formData.get('serviceCode') || '').trim();

  const authorizationId = await db.createServiceAuthorization(session.organizationId, {
    clientId,
    payer: String(formData.get('payer') || '').trim(),
    caseId: String(formData.get('caseId') || '').trim() || null,
    referenceNumber: String(formData.get('referenceNumber') || '').trim() || null,
    serviceCode,
    serviceDescription: String(formData.get('serviceDescription') || '').trim(),
    modifierCodes: String(formData.get('modifierCodes') || '').trim() || null,
    diagnosisCode: String(formData.get('diagnosisCode') || '').trim() || null,
    diagnosisDescription: String(formData.get('diagnosisDescription') || '').trim() || null,
    totalHoursPerWeek: formData.get('totalHoursPerWeek') ? Number(formData.get('totalHoursPerWeek')) : null,
    totalUnitsPerWeek: formData.get('totalUnitsPerWeek') ? Number(formData.get('totalUnitsPerWeek')) : null,
    unitMinutes: formData.get('unitMinutes') ? Number(formData.get('unitMinutes')) : 15,
    // Blank stays null rather than becoming 0 — see createServiceAuthorization.
    ratePerUnit: formData.get('ratePerUnit') ? Number(formData.get('ratePerUnit')) : null,
    frequency: String(formData.get('frequency') || 'Weekly').trim(),
    startDate: String(formData.get('startDate') || '').trim(),
    endDate: String(formData.get('endDate') || '').trim(),
    status: String(formData.get('status') || 'approved').trim(),
    purchasedTasks: parseTaskList(String(formData.get('purchasedTasks') || '')),
    notes: String(formData.get('notes') || '').trim() || null,
  });

  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'create_service_authorization',
    entityType: 'service_authorization',
    entityId: authorizationId,
    detail: `${serviceCode} for client ${clientId}`,
  });

  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  revalidatePath('/admin/finance');
  revalidatePath('/admin/clients');
  // The rate on this authorization is what turns this client's billing
  // lines into dollars on the franchise rollup, so that page is stale now.
  revalidatePath('/admin/locations');
}

// EVV identity card on the care-plan page (Medicaid ID, DOB, structured
// service address). useActionState signature: (prevState, formData).
export async function updateClientEvvIdentityAction(prevState, formData) {
  const session = await requirePermission('admin.clients.evvIdentity.manage');
  const clientId = String(formData.get('clientId') || '').trim();
  if (!clientId) return { error: 'Which client?', success: null };

  let changed;
  try {
    changed = await db.updateClientEvvIdentity(
      session.organizationId,
      clientId,
      {
        medicaidId: formData.get('medicaidId'),
        dateOfBirth: formData.get('dateOfBirth'),
        addressLine1: formData.get('addressLine1'),
        city: formData.get('city'),
        state: formData.get('state'),
        zip: formData.get('zip'),
      },
      session.locationId
    );
  } catch (err) {
    return { error: err.message || 'Could not save.', success: null };
  }

  if (changed.length === 0) return { error: null, success: 'No changes.' };

  // Field NAMES only — the values (Medicaid ID, DOB) are PHI.
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_client_evv_identity',
    entityType: 'client',
    entityId: clientId,
    detail: `changed: ${changed.join(', ')}`,
  });

  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  revalidatePath('/admin/clients');
  return { error: null, success: 'EVV identity saved.' };
}

function actorOf(session) {
  return { userId: session.userId, name: session.name, role: session.role, locationId: session.locationId };
}

async function auditHome(session, clientId, detail) {
  await db.logAuditEvent(session.organizationId, {
    actorUserId: session.userId,
    actorName: session.name,
    actorRole: session.role,
    locationId: session.locationId,
    action: 'update_client_home_location',
    entityType: 'client',
    entityId: clientId,
    // How it was set, never the coordinates themselves (a home address).
    detail,
  });
}

// Client home location (distance-from-home on EVV screens). Staff paste
// coordinates or a map link; see lib/geo.js parseLatLng.
export async function setClientHomeLocationAction(prevState, formData) {
  const session = await requirePermission('admin.clients.evvIdentity.manage');
  const clientId = String(formData.get('clientId') || '').trim();
  const parsed = parseLatLng(formData.get('coordinates'));
  if (!parsed) return { error: 'Paste coordinates like 26.075175, -97.473486 or a Google Maps link.', success: null };
  try {
    await db.setClientHomeLocation(session.organizationId, clientId, parsed, actorOf(session), session.locationId);
  } catch (err) {
    return { error: err.message || 'Could not save the home location.', success: null };
  }
  await auditHome(session, clientId, 'entered by staff');
  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  return { error: null, success: 'Home location saved.' };
}

export async function clearClientHomeLocationAction(prevState, formData) {
  const session = await requirePermission('admin.clients.evvIdentity.manage');
  const clientId = String(formData.get('clientId') || '').trim();
  try {
    await db.clearClientHomeLocation(session.organizationId, clientId, session.locationId);
  } catch (err) {
    return { error: err.message || 'Could not clear the home location.', success: null };
  }
  await auditHome(session, clientId, 'cleared');
  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  return { error: null, success: 'Home location cleared — it will be learned again from the next accurate GPS clock-in at home.' };
}

// From the visit maintenance page: "use this clock-in/out as the client's home".
export async function setClientHomeFromVisitAction(prevState, formData) {
  const session = await requirePermission('admin.clients.evvIdentity.manage');
  const visitId = String(formData.get('visitId') || '').trim();
  const which = String(formData.get('which') || '') === 'out' ? 'out' : 'in';
  let clientId;
  try {
    clientId = await db.setClientHomeFromVisit(session.organizationId, visitId, which, actorOf(session), session.locationId);
  } catch (err) {
    return { error: err.message || 'Could not update the home location.', success: null };
  }
  await auditHome(session, clientId, `taken from visit ${visitId} clock-${which}`);
  revalidatePath(`/admin/evv/visits/${visitId}`);
  revalidatePath(`/admin/clients/${clientId}/care-plan`);
  return { error: null, success: "Saved as the client's home location. Future visits measure distance from here." };
}
