// HTML source documents sent to DocuSign for the caregiver e-signature
// packet, plus the (BAA-gated) Attendant Orientation acknowledgment.
//
// These are uploaded to DocuSign as plain HTML files (fileExtension:
// 'html'), which DocuSign converts to a signable document on receipt —
// simpler and more standard than the separate "responsive HTML" envelope
// feature, and it needs no PDF-generation dependency in the app.
//
// IMPORTANT — placeholder legal text: the paragraphs below are modeled on
// the *structure* of the agency's real paper forms (confidentiality/HIPAA
// agreement, employee handbook acknowledgment, Hepatitis B vaccination
// offer/declination under 29 CFR 1910.1030), not transcribed from them.
// Replace this copy with the agency's actual approved wording before any
// real caregiver signs through this flow — see deferred-backlog.md.
//
// Anchor tags: each signature/date/name field is preceded by a small
// literal string (e.g. "/sig1/") that DocuSign's anchor-tab matching finds
// in the document's text and uses to place the tab. They're styled tiny
// and low-contrast so they don't read as document content, not fully
// invisible — verify placement against a real test envelope once the
// DocuSign developer account is connected, and tighten the styling then.
const ANCHOR_STYLE = 'font-size:1px; color:#fefefe; line-height:1px;';

function anchor(tag) {
  return `<span style="${ANCHOR_STYLE}">${tag}</span>`;
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${title}</title></head>
<body style="font-family: Georgia, 'Times New Roman', serif; font-size: 13px; color: #1a1a1a; line-height: 1.5; max-width: 680px; margin: 0 auto; padding: 32px;">
  <h2 style="font-family: Arial, sans-serif; font-size: 17px; margin-bottom: 4px;">${title}</h2>
  ${bodyHtml}
</body>
</html>`;
}

function signatureBlock(n) {
  return `
  <p style="margin-top: 36px;">
    Signature: ${anchor(`/sig${n}/`)} &nbsp;&nbsp;&nbsp;&nbsp; Date: ${anchor(`/date${n}/`)}
  </p>
  <p style="margin-top: 4px;">Printed name: ${anchor(`/name${n}/`)}</p>`;
}

export function buildConfidentialityHtml({ organizationName, caregiverName }) {
  return page(
    'Confidentiality & HIPAA Acknowledgment',
    `
    <p><strong>${organizationName}</strong></p>
    <p>
      As a condition of employment, I, ${caregiverName || 'the undersigned'}, acknowledge that in the
      course of my work I will have access to protected health information (PHI) and other confidential
      information belonging to clients of ${organizationName}. I agree to:
    </p>
    <ul>
      <li>Use and disclose client PHI only as necessary to perform my job duties;</li>
      <li>Never discuss a client's condition, care, or personal information with anyone who does not
        have a legitimate need to know it;</li>
      <li>Safeguard any records, schedules, or devices containing client information;</li>
      <li>Report any suspected unauthorized disclosure to my supervisor immediately; and</li>
      <li>Understand that this obligation continues after my employment with the agency ends.</li>
    </ul>
    <p>I have read and understand this agreement and agree to be bound by it.</p>
    ${signatureBlock(1)}`
  );
}

export function buildHandbookHtml({ organizationName, caregiverName }) {
  return page(
    'Employee Handbook Acknowledgment',
    `
    <p><strong>${organizationName}</strong></p>
    <p>
      I, ${caregiverName || 'the undersigned'}, acknowledge that I have received, and am responsible for
      reading and following, the ${organizationName} employee handbook, including its policies on
      attendance, conduct, documentation, Electronic Visit Verification (EVV), and reporting of abuse,
      neglect, or exploitation. I understand that the handbook is not a contract of employment and that
      the agency may update its policies from time to time.
    </p>
    ${signatureBlock(1)}`
  );
}

export function buildHepBHtml({ organizationName, caregiverName }) {
  return page(
    'Hepatitis B Vaccination — Offer and Declination',
    `
    <p><strong>${organizationName}</strong></p>
    <p>
      Because my job involves reasonably anticipated exposure to blood or other potentially infectious
      materials, ${organizationName} has offered me, at no cost, the Hepatitis B vaccination series in
      accordance with the OSHA Bloodborne Pathogens Standard (29 CFR 1910.1030).
    </p>
    <p><em>Select one before signing (mark by writing YES or NO next to the option that applies, then sign below):</em></p>
    <p>___ I accept the Hepatitis B vaccination series.</p>
    <p>
      ___ I decline the Hepatitis B vaccination series at this time. I understand that by declining this
      vaccine, I continue to be at risk of acquiring Hepatitis B, a serious disease. I understand that if
      I continue to have occupational exposure to blood or other potentially infectious materials, I can
      request the vaccination series at no charge to me in the future.
    </p>
    ${signatureBlock(1)}`
  );
}

// caregiver_documents.doc_type -> builder, for the three no-PHI packet
// documents. Kept alongside PACKET_DOC_TYPES in lib/queries.js — that list
// is the source of truth for which doc types make up "the packet"; this
// map just needs to cover the same keys.
export const PACKET_BUILDERS = {
  confidentiality: { name: 'Confidentiality & HIPAA Acknowledgment', build: buildConfidentialityHtml },
  handbook: { name: 'Employee Handbook Acknowledgment', build: buildHandbookHtml },
  hep_b: { name: 'Hepatitis B Vaccination — Offer and Declination', build: buildHepBHtml },
};

// Attendant Orientation acknowledgment — deliberately NOT a full replica of
// the rendered /admin/orientations/[id] page (that page's live
// schedule/task rendering is admin-facing detail, not something worth
// duplicating for a document that can't be sent until a BAA is on file
// anyway). This covers the substantive acknowledgment: who, for whom, when,
// and how orientation was delivered, matching 26 TAC §97's per-assignment
// requirement, with a pointer back to the full record kept in Hearth.
export function buildOrientationAcknowledgmentHtml({
  organizationName,
  caregiverName,
  clientName,
  hhscIndividualNumber,
  orientationType,
  method,
  orientedOn,
  agencyRepName,
}) {
  return page(
    'Attendant Orientation Acknowledgment',
    `
    <p><strong>${organizationName}</strong> — Personal Assistance Services</p>
    <p><strong>Attendant:</strong> ${caregiverName || '—'}</p>
    <p><strong>Individual (client):</strong> ${clientName || '—'} ${hhscIndividualNumber ? `(HHSC/DADS Individual #${hhscIndividualNumber})` : ''}</p>
    <p><strong>Orientation type:</strong> ${orientationType || 'Initial'} &nbsp; <strong>Method:</strong> ${method || '—'} &nbsp; <strong>Date:</strong> ${orientedOn || '—'}</p>
    <p>I acknowledge that I have received orientation, per 26 TAC §97, regarding:</p>
    <ul>
      <li>This client's service plan, needs, and the tasks I am authorized to perform;</li>
      <li>The agency's attendance, documentation, and reporting requirements;</li>
      <li>Electronic Visit Verification (EVV) use procedures for this assignment; and</li>
      <li>Emergency procedures and reporting of abuse, neglect, or exploitation.</li>
    </ul>
    <p>The full authorized task list and visit schedule for this assignment are kept on file in Hearth.</p>
    ${agencyRepName ? `<p>Orientation delivered by ${agencyRepName}.</p>` : ''}
    ${signatureBlock(1)}`
  );
}
