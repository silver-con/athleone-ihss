// QA for fax / document intake (2026-09-26): reading the sample faxes,
// field mapping, validation, the store -> read -> review -> approve pipeline,
// duplicates, tenant isolation, and the Google Document AI / Cloud Storage /
// Google sign-in code paths (with a fake fetch — Google is never called).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';

process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'athleone-storage-'));
for (const k of ['DOCAI_PROVIDER', 'GOOGLE_CLOUD_PROJECT', 'DOCAI_PROCESSOR_ID', 'DOCAI_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'STORAGE_DRIVER', 'GCS_BUCKET']) delete process.env[k];

const db = await import('./queries.js');
const { query, queryOne, pool } = await import('./db.js');
const { readDocument, docaiStatus } = await import('./docai/index.js');
const { fieldsFromEntities, fieldsFromText, formFieldLines, normalizeName, normalizeHours, normalizeDate, normalizeFields, classifyDocument } = await import('./docai/parse.js');
const { validateFields, hasBlockingIssues } = await import('./docai/validate.js');
const { extractWithGoogle, processUrl, googleDocaiConfig } = await import('./docai/google.js');
const { getGoogleAccessToken, clearGoogleTokenCache } = await import('./google-auth.js');
const { putFile, getFile } = await import('./storage.js');
const { ingestDocument, processDocument, sniffMimeType } = await import('./intake.js');
const { sampleFaxesEnabled } = await import('./docai/samples.js');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, a, e) { check(name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
async function throws(name, fn, match) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && (!match || msg.includes(match)), msg === null ? 'did not throw' : `threw "${msg}"`);
}
const sample = (f) => readFileSync(path.join('sample-faxes', f));
const ORG = 'org-fax';
const OTHER = 'org-fax-2';

async function run() {
  await query(`INSERT INTO organizations (id,name,status) VALUES ($1,'Fax Agency','active'), ($2,'Other Agency','active')`, [ORG, OTHER]);

  console.log('\n== demo engine reads the sample faxes ==');
  eq('default engine is demo', docaiStatus().provider, 'demo');
  const molina = await readDocument(sample('molina-authorization-rosa-delgado.pdf'), 'application/pdf');
  const m = Object.fromEntries(Object.entries(molina.fields).map(([k, v]) => [k, v.value]));
  eq('Molina: client', m.clientName, 'Rosa M. Delgado');
  eq('Molina: DOB', m.dob, '03/08/1944');
  eq('Molina: Medicaid ID (spaces removed)', m.medicaidId, '520481736');
  eq('Molina: auth #', m.authNumber, 'MOL-PAS-2026-77310');
  eq('Molina: hours normalised', m.authHours, '18 hrs/wk');
  eq('Molina: date range split', [m.authStart, m.authEnd], ['10/01/2026', '03/31/2027']);
  eq('Molina: procedure code', m.serviceCode, 'S5125 U5');
  eq('Molina: found on page 2 of 2', [molina.fields.clientName.page, molina.pageCount], [2, 2]);
  eq('Molina: classified as an authorization', molina.docType, 'authorization');
  check('Molina: no blocking problems', !hasBlockingIssues(validateFields(molina.fields)));

  const sup = await readDocument(sample('superior-referral-lionel-brooks.pdf'), 'application/pdf');
  eq('Superior: "BROOKS, LIONEL J" becomes "Lionel J Brooks"', sup.fields.clientName.value, 'Lionel J Brooks');
  eq('Superior: payer recognised from the letterhead', sup.fields.payer.value, 'Superior HealthPlan');
  check('  ...marked less certain (letterhead, not a label)', sup.fields.payer.confidence < 0.7);
  eq('Superior: Medicaid ID with dashes', sup.fields.medicaidId.value, '618203554');

  const hosp = await readDocument(sample('hospital-discharge-incomplete.pdf'), 'application/pdf');
  const hi = validateFields(hosp.fields);
  check('hospital: missing auth # is a blocking error', hi.authNumber?.some((i) => i.level === 'error'));
  check('hospital: "TBD" hours is a blocking error', hi.authHours?.some((i) => i.level === 'error'));
  check('hospital: no Medicaid ID is only a warning', hi.medicaidId?.every((i) => i.level === 'warn'));
  eq('hospital: single-digit DOB padded', hosp.fields.dob.value, '07/02/1938');

  await throws('demo mode refuses an image with a clear message', () => readDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'), 'Google Document AI');

  console.log('\n== mapping helpers ==');
  eq('entity mapping (Custom Extractor names)', fieldsFromEntities([
    { type: 'client_name', mentionText: 'Ada Lovelace', confidence: 0.97, pageAnchor: { pageRefs: [{ page: '1' }] } },
    { type: 'date_of_birth', mentionText: 'Dec 10 1815', normalizedValue: { text: '1815-12-10' }, confidence: 0.9 },
    { type: 'unrelated', mentionText: 'x' },
  ]), { clientName: { value: 'Ada Lovelace', confidence: 0.97, page: 2, source: 'engine' }, dob: { value: '1815-12-10', confidence: 0.9, page: null, source: 'engine' } });
  const doc = { text: 'Member Name\nJo Smith\nAuth #\nA-1\n', pages: [{ pageNumber: 1, formFields: [
    { fieldName: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 11 }] } }, fieldValue: { textAnchor: { textSegments: [{ startIndex: 12, endIndex: 20 }] }, confidence: 0.93 } },
    { fieldName: { textAnchor: { textSegments: [{ startIndex: 21, endIndex: 27 }] } }, fieldValue: { textAnchor: { textSegments: [{ startIndex: 28, endIndex: 31 }] } } },
  ] }] };
  const ff = fieldsFromText(formFieldLines(doc), { source: 'form' });
  eq('Form Parser key/value pairs mapped by label', [ff.clientName?.value, ff.authNumber?.value, ff.clientName?.confidence], ['Jo Smith', 'A-1', 0.93]);
  eq('label on one line, value on the next', fieldsFromText('Date of Birth\n01/02/1950').dob?.value, '01/02/1950');
  eq('"Name" does not grab "Named insured…"', fieldsFromText('Named insured policy').clientName, undefined);
  eq('hours: "12 hours per week"', normalizeHours('12 hours per week'), '12 hrs/wk');
  eq('hours: "3 hrs/day"', normalizeHours('3 hrs/day'), '3 hrs/day');
  eq('dates: 2-digit year', normalizeDate('3/8/44'), '03/08/1944');
  eq('dates: ISO', normalizeDate('2026-10-01'), '10/01/2026');
  eq('names: mixed case kept', normalizeName('Rosa McDonald'), 'Rosa McDonald');
  eq('classify: discharge', classifyDocument('Discharge planning referral'), 'discharge referral');

  console.log('\n== validation ==');
  const v = (o) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k, { value: val, confidence: 1, source: 'reviewer' }]));
  const good = { clientName: 'A B', dob: '01/02/1950', medicaidId: '123456789', payer: 'P', authNumber: 'X', service: 'PAS', authHours: '10 hrs/wk', diagnosis: 'D', authStart: '10/01/2026', authEnd: '03/31/2027' };
  check('a complete referral passes', !hasBlockingIssues(validateFields(v(good), { today: new Date('2026-09-26') })));
  check('8-digit Medicaid ID is an error', validateFields(v({ ...good, medicaidId: '12345678' })).medicaidId?.[0].level === 'error');
  check('DOB in the future is an error', validateFields(v({ ...good, dob: '01/01/2090' })).dob?.[0].level === 'error');
  check('Feb 30 is an error', validateFields(v({ ...good, dob: '02/30/1950' })).dob?.[0].level === 'error');
  check('end before start is an error', validateFields(v({ ...good, authEnd: '09/01/2026' })).authEnd?.some((i) => i.level === 'error'));
  check('expired authorization is a warning', validateFields(v({ ...good, authStart: '01/01/2025', authEnd: '06/01/2025' }), { today: new Date('2026-09-26') }).authEnd?.some((i) => i.level === 'warn'));
  check('low confidence from the reader is a warning', validateFields({ ...v(good), payer: { value: 'P', confidence: 0.5, source: 'letterhead' } }).payer?.[0].level === 'warn');
  check('...but not once the reviewer edited it', !validateFields({ ...v(good), payer: { value: 'P', confidence: 0.5, source: 'reviewer' } }).payer);

  console.log('\n== file type is decided by content ==');
  eq('PDF', sniffMimeType(Buffer.from('%PDF-1.4')), 'application/pdf');
  eq('PNG', sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  eq('TIFF (little-endian)', sniffMimeType(Buffer.from([0x49, 0x49, 0x2a, 0x00])), 'image/tiff');
  eq('an .exe named fax.pdf is refused', sniffMimeType(Buffer.from('MZ\x90\x00')), null);

  console.log('\n== pipeline: store, read, review, approve ==');
  const bad = await ingestDocument({ organizationId: ORG, buffer: Buffer.from('MZ not a pdf'), fileName: 'fax.pdf', source: 'upload' });
  check('a non-document is refused', !bad.ok && /PDF, TIFF/.test(bad.error));
  check('an empty file is refused', !(await ingestDocument({ organizationId: ORG, buffer: Buffer.alloc(0), source: 'upload' })).ok);
  const molinaBuf = sample('molina-authorization-rosa-delgado.pdf');
  const r1 = await ingestDocument({ organizationId: ORG, buffer: molinaBuf, fileName: '../../etc/passwd rosa.pdf', source: 'fax', sender: '(866) 555-0142', userId: 'u1' });
  check('a fax is stored', r1.ok && r1.id);
  let d1 = await db.getIncomingDocument(ORG, r1.id);
  eq('  ...status received', d1.status, 'received');
  check('  ...file name made safe', !d1.fileName.includes('/') && d1.fileName.endsWith('rosa.pdf'));
  check('  ...stored under the agency, by id', d1.fileKey === `${ORG}/incoming/${r1.id}.pdf`);
  check('  ...bytes round-trip from storage', Buffer.compare(await getFile(d1.fileKey), molinaBuf) === 0);
  const again = await ingestDocument({ organizationId: ORG, buffer: molinaBuf, source: 'fax' });
  eq('the same fax sent twice is not duplicated', again.duplicateOf, r1.id);
  const elsewhere = await ingestDocument({ organizationId: OTHER, buffer: molinaBuf, source: 'fax' });
  check('...but another agency receiving it gets its own copy', elsewhere.ok && !elsewhere.duplicateOf);

  const p1 = await processDocument(ORG, r1.id);
  check('reading succeeds', p1.ok);
  d1 = await db.getIncomingDocument(ORG, r1.id);
  eq('  ...needs review', d1.status, 'needs_review');
  eq('  ...fields saved', d1.extraction.fields.clientName.value, 'Rosa M. Delgado');
  check('  ...text kept for the reviewer', d1.rawText.includes('SERVICE AUTHORIZATION'));
  eq('reading again when already done does nothing', (await processDocument(ORG, r1.id)).ok, false);
  eq('inbox count', await db.countIncomingDocumentsToReview(ORG), 1);
  eq('the other agency sees only its own document', (await db.getIncomingDocuments(OTHER)).map((d) => d.id), [elsewhere.id]);
  eq("the other agency can't open this one", await db.getIncomingDocument(OTHER, r1.id), null);

  const fields = Object.fromEntries(Object.entries(d1.extraction.fields).map(([k, val]) => [k, val.value]));
  await throws('approve needs the required fields', () => db.approveIncomingDocument(ORG, r1.id, { fields: { ...fields, authNumber: '' }, reviewer: { userId: 'u1', name: 'Cora' } }), 'authNumber');
  await throws("another agency can't approve it", () => db.approveIncomingDocument(OTHER, r1.id, { fields, reviewer: { userId: 'x', name: 'X' } }), 'not found');
  const referralId = await db.approveIncomingDocument(ORG, r1.id, { fields: { ...fields, clientName: 'Rosa Maria Delgado' }, reviewer: { userId: 'u1', name: 'Cora Coordinator' } });
  const ref = await db.getReferral(ORG, referralId);
  eq('approve creates a referral with the reviewer’s values', [ref.clientName, ref.authNumber, ref.status], ['Rosa Maria Delgado', 'MOL-PAS-2026-77310', 'new']);
  check('  ...linked to the original document, with the extra fields', ref.fax.documentId === r1.id && ref.fax.medicaidId === '520481736' && ref.fax.effectiveDates === '10/01/2026 – 03/31/2027');
  check('  ...received date is today (MM/DD/YYYY)', /^\d{2}\/\d{2}\/\d{4}$/.test(ref.receivedDate));
  d1 = await db.getIncomingDocument(ORG, r1.id);
  eq('  ...document approved, by whom', [d1.status, d1.reviewedByName, d1.referralId], ['approved', 'Cora Coordinator', referralId]);
  check('  ...both what was read and what was approved are kept', d1.extraction.fields.clientName.value === 'Rosa M. Delgado' && d1.extraction.approvedFields.clientName === 'Rosa Maria Delgado');
  await throws('it cannot be approved twice', () => db.approveIncomingDocument(ORG, r1.id, { fields, reviewer: {} }), 'already approved');
  const [a, b] = await Promise.allSettled([
    (async () => { const x = await ingestDocument({ organizationId: ORG, buffer: sample('superior-referral-lionel-brooks.pdf'), source: 'fax' }); await processDocument(ORG, x.id); return x.id; })(),
  ]);
  const supId = a.value;
  const supFields = Object.fromEntries(Object.entries((await db.getIncomingDocument(ORG, supId)).extraction.fields).map(([k, val]) => [k, val.value]));
  const race = await Promise.allSettled([
    db.approveIncomingDocument(ORG, supId, { fields: supFields, reviewer: { name: 'A' } }),
    db.approveIncomingDocument(ORG, supId, { fields: supFields, reviewer: { name: 'B' } }),
  ]);
  eq('two people approving at once: exactly one referral', race.filter((x) => x.status === 'fulfilled').length, 1);
  eq('  ...one referral row for that auth #', (await queryOne(`SELECT count(*)::int AS n FROM referrals WHERE organization_id = $1 AND auth_number = 'SHP-2026-0930-4471'`, [ORG])).n, 1);
  void b;

  console.log('\n== duplicates ==');
  const dup = await db.findIntakeDuplicates(ORG, { medicaidId: '999', clientName: 'Rosa Maria Delgado', dob: '03/08/1944', authNumber: 'mol-pas-2026-77310' });
  check('an existing referral with the same auth # (any case) is flagged', dup.referrals.some((r) => r.sameAuthNumber));
  await query(`INSERT INTO clients (id, organization_id, name, payer, auth_hours, intake_date, medicaid_id, date_of_birth) VALUES ('c-rosa',$1,'Rosa Maria Delgado','Molina','18','09/01/2026','520481736','1944-03-08')`, [ORG]);
  const dup2 = await db.findIntakeDuplicates(ORG, { medicaidId: '520481736' });
  check('an existing client with the same Medicaid ID is flagged', dup2.clients.some((c) => c.sameMedicaidId));
  const dup3 = await db.findIntakeDuplicates(ORG, { clientName: 'rosa maria delgado', dob: '03/08/1944' });
  check('...or the same name + DOB', dup3.clients.length === 1);
  eq('no false duplicate in another agency', (await db.findIntakeDuplicates(OTHER, { medicaidId: '520481736' })).clients, []);

  console.log('\n== reject, failure, retry ==');
  const h = await ingestDocument({ organizationId: ORG, buffer: sample('hospital-discharge-incomplete.pdf'), source: 'upload' });
  await processDocument(ORG, h.id);
  await db.rejectIncomingDocument(ORG, h.id, { reason: 'No authorization yet', reviewer: { userId: 'u1', name: 'Cora' } });
  const hd = await db.getIncomingDocument(ORG, h.id);
  eq('rejected with a reason', [hd.status, hd.rejectReason], ['rejected', 'No authorization yet']);
  await throws("a rejected document can't be approved", () => db.approveIncomingDocument(ORG, h.id, { fields: good, reviewer: {} }), 'isn’t ready');
  const img = await ingestDocument({ organizationId: ORG, buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]), fileName: 'photo.jpg', source: 'upload' });
  const pimg = await processDocument(ORG, img.id);
  check('a photo in demo mode fails with a readable reason', !pimg.ok && /Google Document AI/.test(pimg.error));
  eq('  ...status failed (can be retried)', (await db.getIncomingDocument(ORG, img.id)).status, 'failed');
  eq('  ...and counts as still to review', await db.countIncomingDocumentsToReview(ORG), 1);

  console.log('\n== Google Document AI (fake fetch) ==');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const saJson = JSON.stringify({ client_email: 'docai@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'kid1', token_uri: 'https://oauth2.googleapis.com/token', project_id: 'proj' });
  const env = { DOCAI_PROVIDER: 'google', GOOGLE_CLOUD_PROJECT: 'proj', DOCAI_PROCESSOR_ID: 'abc123', DOCAI_LOCATION: 'us', GOOGLE_SERVICE_ACCOUNT_JSON: saJson };
  eq('status: missing settings named', docaiStatus({ DOCAI_PROVIDER: 'google' }).missing, ['GOOGLE_CLOUD_PROJECT', 'DOCAI_PROCESSOR_ID']);
  check('status: live with project + processor', docaiStatus(env).live);
  eq('process URL', processUrl(googleDocaiConfig(env)), 'https://us-documentai.googleapis.com/v1/projects/proj/locations/us/processors/abc123:process');
  eq('process URL with a pinned version', processUrl(googleDocaiConfig({ ...env, DOCAI_PROCESSOR_VERSION: 'v2' })), 'https://us-documentai.googleapis.com/v1/projects/proj/locations/us/processors/abc123/processorVersions/v2:process');

  const calls = [];
  const fakeGoogle = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.fake', expires_in: 3600 });
    if (url.includes(':process')) {
      return Response.json({ document: { text: 'SERVICE AUTHORIZATION\nMember Name: Wrong From Text\nAuth #: TXT-1\n', pages: [{ pageNumber: 1 }], entities: [
        { type: 'client_name', mentionText: 'Maria Lopez', confidence: 0.98, pageAnchor: { pageRefs: [{}] } },
        { type: 'date_of_birth', mentionText: '4/5/1950', confidence: 0.95 },
        { type: 'medicaid_id', mentionText: '111 222 333', confidence: 0.52 },
      ] } });
    }
    throw new Error('unexpected ' + url);
  };
  clearGoogleTokenCache();
  const g = await readDocument(Buffer.from('%PDF-fake'), 'application/pdf', { fetchImpl: fakeGoogle, env });
  eq('engine is google', g.engine, 'google-docai');
  eq('entities win over text', g.fields.clientName.value, 'Maria Lopez');
  eq('entity dates normalised', g.fields.dob.value, '04/05/1950');
  eq('text fills what entities missed', g.fields.authNumber.value, 'TXT-1');
  check('low-confidence entity flagged for review', validateFields(g.fields).medicaidId?.some((i) => i.level === 'warn'));
  const tokenCall = calls.find((c) => c.url.includes('oauth2'));
  const assertion = new URLSearchParams(tokenCall.init.body.toString()).get('assertion');
  const claims = decodeJwt(assertion);
  eq('service-account JWT: issuer, audience, scope', [claims.iss, claims.aud, claims.scope], ['docai@proj.iam.gserviceaccount.com', 'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/auth/cloud-platform']);
  eq('  ...signed RS256 with the key id', [decodeProtectedHeader(assertion).alg, decodeProtectedHeader(assertion).kid], ['RS256', 'kid1']);
  const procCall = calls.find((c) => c.url.includes(':process'));
  eq('  ...Document AI called with the bearer token', procCall.init.headers.Authorization, 'Bearer ya29.fake');
  eq('  ...and the file as base64 with its type', JSON.parse(procCall.init.body).rawDocument, { content: Buffer.from('%PDF-fake').toString('base64'), mimeType: 'application/pdf' });
  calls.length = 0;
  await readDocument(Buffer.from('%PDF-fake'), 'application/pdf', { fetchImpl: fakeGoogle, env });
  eq('the access token is reused (cached)', calls.filter((c) => c.url.includes('oauth2')).length, 0);

  let maskRetry = 0;
  const maskFetch = async (url, init) => {
    if (url.includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
    const body = JSON.parse(init.body);
    if (body.fieldMask) { maskRetry++; return Response.json({ error: { message: 'Invalid field mask' } }, { status: 400 }); }
    return Response.json({ document: { text: 'Member Name: Ok Now', pages: [{}] } });
  };
  clearGoogleTokenCache();
  const gm = await readDocument(Buffer.from('%PDF'), 'application/pdf', { fetchImpl: maskFetch, env });
  check('a processor that rejects the field mask is retried without it', maskRetry === 1 && gm.fields.clientName.value === 'Ok Now');
  const errFetch = async (url) => (url.includes('oauth2') ? Response.json({ access_token: 't', expires_in: 3600 }) : Response.json({ error: { message: 'Processor not found' } }, { status: 404 }));
  clearGoogleTokenCache();
  await throws('a Google error is reported in plain words', () => readDocument(Buffer.from('%PDF'), 'application/pdf', { fetchImpl: errFetch, env }), 'Processor not found');
  await throws('missing settings are named before calling Google', () => extractWithGoogle(Buffer.from('%PDF'), 'application/pdf', { env: { DOCAI_PROVIDER: 'google' } }), 'GOOGLE_CLOUD_PROJECT');

  clearGoogleTokenCache();
  const meta = [];
  const metaFetch = async (url, init) => { meta.push({ url, init }); return Response.json({ access_token: 'from-metadata', expires_in: 3000 }); };
  eq('no key configured: the Cloud Run metadata server is used', await getGoogleAccessToken({ fetchImpl: metaFetch, env: {} }), 'from-metadata');
  check('  ...with the Metadata-Flavor header', meta[0].url.includes('metadata.google.internal') && meta[0].init.headers['Metadata-Flavor'] === 'Google');
  clearGoogleTokenCache();
  await throws('no key and not on Google Cloud: a clear message', () => getGoogleAccessToken({ fetchImpl: async () => { throw new Error('ENOTFOUND'); }, env: {} }), 'GOOGLE_APPLICATION_CREDENTIALS');

  console.log('\n== Cloud Storage driver (fake fetch) ==');
  clearGoogleTokenCache();
  const gcs = [];
  const gcsFetch = async (url, init = {}) => {
    gcs.push({ url, init });
    if (url.includes('oauth2')) return Response.json({ access_token: 'gcs-token', expires_in: 3600 });
    if (init.method === 'POST') return Response.json({ name: 'x' });
    return new Response(Buffer.from('stored-bytes'));
  };
  const genv = { STORAGE_DRIVER: 'gcs', GCS_BUCKET: 'athleone-faxes', GOOGLE_SERVICE_ACCOUNT_JSON: saJson };
  await putFile('org-1/incoming/doc.pdf', Buffer.from('abc'), 'application/pdf', { fetchImpl: gcsFetch, env: genv });
  const up = gcs.find((c) => c.init.method === 'POST' && c.url.includes('/upload/'));
  eq('upload goes to the bucket with the object name encoded', up.url, 'https://storage.googleapis.com/upload/storage/v1/b/athleone-faxes/o?uploadType=media&ifGenerationMatch=0&name=org-1%2Fincoming%2Fdoc.pdf');
  eq('  ...authorised', up.init.headers.Authorization, 'Bearer gcs-token');
  const got = await getFile('org-1/incoming/doc.pdf', { fetchImpl: gcsFetch, env: genv });
  eq('download returns the bytes', got.toString(), 'stored-bytes');
  await throws('a key trying to escape the folder is refused', () => putFile('org-1/../../etc/passwd', Buffer.from('x'), 'text/plain'), 'Bad storage key');
  await throws('gcs without a bucket is refused', () => putFile('a/b.pdf', Buffer.from('x'), 'application/pdf', { env: { STORAGE_DRIVER: 'gcs' } }), 'GCS_BUCKET');
  await throws('  ...also for downloads', () => getFile('a/b.pdf', { env: { STORAGE_DRIVER: 'gcs' } }), 'GCS_BUCKET');

  console.log('\n== Personal gcloud login (no key file) ==');
  {
    const dir = mkdtempSync(path.join(tmpdir(), 'athleone-gcloud-'));
    writeFileSync(path.join(dir, 'application_default_credentials.json'), JSON.stringify({ type: 'authorized_user', client_id: 'cid', client_secret: 'csec', refresh_token: 'rtok-12345678', quota_project_id: 'quota-proj' }));
    const uenv = { CLOUDSDK_CONFIG: dir, GOOGLE_CLOUD_PROJECT: 'athleone', DOCAI_PROVIDER: 'google', DOCAI_PROCESSOR_ID: 'proc1', DOCAI_LOCATION: 'us' };
    const calls = [];
    const ufetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return Response.json({ access_token: 'user-token', expires_in: 3600 });
      return Response.json({ document: { text: 'Member Name: Test Person\n', entities: [{ type: 'client_name', mentionText: 'Test Person', confidence: 0.95 }], pages: [{ pageNumber: 1 }] } });
    };
    clearGoogleTokenCache();
    const { googleCredentialSource } = await import('./google-auth.js');
    check('the gcloud login file is found', googleCredentialSource(uenv).includes('gcloud login'), googleCredentialSource(uenv));
    const ur = await extractWithGoogle(Buffer.from('%PDF-1.4 x'), 'application/pdf', { fetchImpl: ufetch, env: uenv });
    const tok = calls.find((c) => c.url.includes('oauth2'));
    check('  ...signs in with the refresh token', String(tok?.init?.body).includes('grant_type=refresh_token'));
    const api = calls.find((c) => c.url.includes('documentai'));
    eq('  ...calls Document AI with the user token', api?.init?.headers?.Authorization, 'Bearer user-token');
    eq('  ...and names the project to bill', api?.init?.headers?.['x-goog-user-project'], 'athleone');
    check('  ...and reads the fields', JSON.stringify(ur).includes('Test Person'));
    const onRun = { ...uenv, K_SERVICE: 'athleone' };
    check('on Cloud Run a stray login file is ignored', googleCredentialSource(onRun).includes('metadata'));
    clearGoogleTokenCache();
  }

  console.log('\n== Google rejects the field mask with a plain "invalid argument" ==');
  {
    let n = 0;
    const bodies = [];
    const mfetch = async (url, init = {}) => {
      if (url.includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
      n++;
      bodies.push(JSON.parse(init.body));
      if (n === 1) return Response.json({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }, { status: 400 });
      return Response.json({ document: { text: 'x', entities: [{ type: 'client_name', mentionText: 'Masked Retry', confidence: 0.9 }], pages: [{ pageNumber: 1 }] } });
    };
    clearGoogleTokenCache();
    const menv = { GOOGLE_SERVICE_ACCOUNT_JSON: saJson, GOOGLE_CLOUD_PROJECT: 'p', DOCAI_PROCESSOR_ID: 'x', DOCAI_PROVIDER: 'google' };
    const mr = await extractWithGoogle(Buffer.from('%PDF'), 'application/pdf', { fetchImpl: mfetch, env: menv });
    check('a plain 400 is retried without the field mask', n === 2 && 'fieldMask' in bodies[0] && !('fieldMask' in bodies[1]));
    check('  ...and the retry\'s result is used', JSON.stringify(mr).includes('Masked Retry'));
    const efetch = async (url) => url.includes('oauth2') ? Response.json({ access_token: 't', expires_in: 3600 })
      : Response.json({ error: { code: 400, message: 'Request contains an invalid argument.', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'processor', description: 'Processor has no deployed version' }] }] } }, { status: 400 });
    clearGoogleTokenCache();
    await throws('Google\'s explanation is shown to the reviewer', () => extractWithGoogle(Buffer.from('%PDF'), 'application/pdf', { fetchImpl: efetch, env: menv }), 'no deployed version');
    clearGoogleTokenCache();
  }

  console.log('\n== Real-world layouts (Molina-style authorization, fictional values) ==');
  {
    const { entitySummary, normalizeEntityType } = await import('./docai/parse.js');
    eq('schema names are matched loosely', ['Client Name', 'date-of-birth', 'Referral/medicaidId'].map(normalizeEntityType), ['client_name', 'date_of_birth', 'medicaid_id']);
    const nested = [{ type: 'referral', properties: [
      { type: 'Client Name', mentionText: 'DOE, JANE Q', confidence: 0.91 },
      { type: 'date_of_birth', mentionText: 'March 3, 1941', normalizedValue: { dateValue: { year: 1941, month: 3, day: 3 } }, confidence: 0.9 },
      { type: 'member_dob_extra', mentionText: 'x' },
    ] }];
    const nf = normalizeFields(fieldsFromEntities(nested));
    eq('nested Custom Extractor fields are read', [nf.clientName?.value, nf.dob?.value], ['Jane Q Doe', '03/03/1941']);
    const sum = entitySummary(nested);
    check('the review screen can list what Google returned', sum.some((e) => e.name === 'client_name' && e.field === 'clientName') && sum.some((e) => e.name === 'member_dob_extra' && !e.field));
    const molina = [
      'Utilization Management', 'Phone: (800) 555-0100', 'Fax Coversheet', 'To: SAMPLE HOME CARE LLC',
      '\f',
    ].join('\n') + [
      'Authorization Notification', 'Health Plan ID: 900000001', 'Member Name: DOE, JANE Q', 'Member DOB: 03/03/1941',
      'Reference#: PUM000000001', 'Service Code', '$5125', '29 hrs on a 7 day plan',
      'Member Phone', '(214) 555-0199', 'Member Address', '12 ELM ST DALLAS TX', '75201',
      'Diagnosis code Diagnosis description', 'I10 ESSENTIAL PRIMARY HYPERTENSION Principal',
    ].join('\n');
    const mf = normalizeFields(fieldsFromText(molina, { confidence: 0.7 }));
    eq('cover sheet phone is skipped; the member phone is used', mf.phone?.value, '(214) 555-0199');
    check('"Health Plan ID: …" is not taken as the payer', !/ID/.test(mf.payer?.value || '') , mf.payer?.value);
    eq('Reference# is read as the authorization number', mf.authNumber?.value, 'PUM000000001');
    eq('"$5125" (OCR) becomes S5125', mf.serviceCode?.value, 'S5125');
    eq('hours from "29 hrs on a 7 day plan"', mf.authHours?.value, '29 hrs/wk');
    eq('ZIP on the next line is joined to the address', mf.address?.value, '12 ELM ST DALLAS TX 75201');
    eq('diagnosis from the diagnosis table', mf.diagnosis?.value, 'ESSENTIAL PRIMARY HYPERTENSION (I10)');
    eq('member DOB label', mf.dob?.value, '03/03/1941');
  }

  console.log('\n== Full authorization detail -> care plan at intake (fictional values) ==');
  {
    const { authorizationFromFax, splitTasks, authStatusFromFax } = await import('./fax-authorization.js');
    const page = [
      'Authorization Notification', 'Auth Status: Approved', 'Review Date: 09/12/2026',
      'Case ID', 'LTSS-00000001', 'Modifier Code1', 'U5', 'Total Units Per Week', '116', 'Total Units', '6544',
      'Diagnosis code', 'I10', 'Service Coordinator', 'Pat Sample', 'Service Coordinator Phone', '(972) 555-0142',
      'Service Coordinator Email', 'pat.sample@example.com',
      'Purchased Tasks: BATHING, Dressing, Exercise, Grooming (Shaving, Oral care, Nail Care),',
      'Toileting, Transfer, Walking, Meal Prep (breakfast, lunch), Shopping',
    ].join('\n');
    const pf = normalizeFields(fieldsFromText(page, { confidence: 0.7 }));
    eq('status, case ID, modifier, units and review date are read', [pf.authStatus?.value, pf.caseId?.value, pf.modifier?.value, pf.unitsPerWeek?.value, pf.totalUnits?.value, pf.reviewDate?.value], ['Approved', 'LTSS-00000001', 'U5', '116', '6544', '09/12/2026']);
    eq('diagnosis code and coordinator are read', [pf.diagnosisCode?.value, pf.coordinatorName?.value, pf.coordinatorPhone?.value, pf.coordinatorEmail?.value], ['I10', 'Pat Sample', '(972) 555-0142', 'pat.sample@example.com']);
    check('a task list that wraps onto the next line is read whole', /Grooming \(Shaving, Oral care, Nail Care\), Toileting, Transfer, Walking, Meal Prep \(breakfast, lunch\), Shopping$/.test(pf.approvedTasks?.value || ''), pf.approvedTasks?.value);
    eq('tasks split on commas, not inside brackets', splitTasks('BATHING, Dressing, Grooming (Shaving, Oral care), Toileting'), ['Bathing', 'Dressing', 'Grooming (Shaving, Oral care)', 'Toileting']);
    eq('fax status -> care plan status', ['Approved', 'Pended', 'Denied', ''].map(authStatusFromFax), ['approved', 'pending', 'denied', 'pending']);

    const vf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 1 }]));
    const base = { clientName: 'A B', dob: '01/01/1950', payer: 'Molina', authNumber: 'X1', service: 'PAS', authHours: '29 hrs/wk', diagnosis: 'HTN', authStart: '09/01/2026', authEnd: '09/30/2027' };
    const denied = validateFields(vf({ ...base, authStatus: 'Denied' }), { checkConfidence: false, today: new Date('2026-09-26') });
    check('a denied authorization blocks approval', (denied.authStatus || []).some((i) => i.level === 'error'));
    const mismatch = validateFields(vf({ ...base, unitsPerWeek: '100' }), { checkConfidence: false, today: new Date('2026-09-26') });
    check('units that don\'t match the hours are flagged', (mismatch.unitsPerWeek || []).some((i) => i.level === 'warn'));
    const totals = validateFields(vf({ ...base, unitsPerWeek: '116', totalUnits: '2555' }), { checkConfidence: false, today: new Date('2026-09-26') });
    check('a total that doesn\'t match units x weeks is flagged', (totals.totalUnits || []).some((i) => i.level === 'warn' && /6,5\d\d/.test(i.message)), JSON.stringify(totals.totalUnits));
    const okTotals = validateFields(vf({ ...base, unitsPerWeek: '116', totalUnits: '6544' }), { checkConfidence: false, today: new Date('2026-09-26') });
    check('  ...and a matching total is not', !okTotals.totalUnits && !okTotals.unitsPerWeek);

    const auth = authorizationFromFax({ payer: 'Molina Healthcare', service: 'Non-Waiver PAS Agency Model', authHours: '29 hrs/wk', authNumber: 'PUM000000001', diagnosis: 'ESSENTIAL PRIMARY HYPERTENSION',
      fax: { serviceCode: 'S5125', modifier: 'U5', authStart: '09/01/2026', authEnd: '09/30/2027', authStatus: 'Approved', caseId: 'LTSS-00000001', unitsPerWeek: '116', totalUnits: '6544', diagnosisCode: 'I10', approvedTasks: 'BATHING, Dressing, Grooming (Shaving, Oral care)', coordinator: { name: 'Pat Sample' } } }, 'c-1');
    eq('the care plan built from the fax', [auth.serviceCode, auth.modifierCodes, auth.totalHoursPerWeek, auth.totalUnitsPerWeek, auth.startDate, auth.endDate, auth.status, auth.diagnosisCode, auth.caseId, auth.referenceNumber, auth.purchasedTasks.length],
      ['S5125', 'U5', 29, 116, '2026-09-01', '2027-09-30', 'approved', 'I10', 'LTSS-00000001', 'PUM000000001', 3]);
    eq('no service code or dates -> no care plan (office adds it by hand)', authorizationFromFax({ fax: { serviceCode: 'S5125' } }, 'c'), null);

    // End to end: an approved fax's referral completes intake -> the care plan exists.
    const rid = 'ref-fax-careplan';
    await query(`INSERT INTO referrals (id, organization_id, payer, client_name, dob, service, auth_hours, auth_number, diagnosis, received_date, status, fax)
                 VALUES ($1,$2,'Molina Healthcare','Pat Q Example','01/01/1950','Non-Waiver PAS Agency Model','29 hrs/wk','PUM000000009','ESSENTIAL PRIMARY HYPERTENSION','09/26/2026','new',$3)`,
      [rid, ORG, JSON.stringify({ serviceCode: 'S5125 U5', authStart: '09/01/2026', authEnd: '09/30/2027', authStatus: 'Approved', unitsPerWeek: '116', diagnosisCode: 'I10', approvedTasks: 'Bathing, Dressing', caseId: 'LTSS-00000009' })]);
    const res = await db.submitIntake(ORG, rid, { clientName: 'Pat Q Example', dob: '01/01/1950', memberId: '900000009', address: '1 Main St', city: 'Dallas', state: 'TX', zip: '75201', careNeeds: [] });
    check('intake reports the care plan it created', Boolean(res.authorizationId) && res.authorizationStatus === 'approved');
    const sa = await queryOne('SELECT * FROM service_authorizations WHERE organization_id = $1 AND id = $2', [ORG, res.authorizationId]);
    eq('  ...stored for the new client', [sa?.client_id, sa?.service_code, sa?.modifier_codes, Number(sa?.total_units_per_week), sa?.start_date, sa?.status, sa?.purchased_tasks], [res.clientId, 'S5125', 'U5', 116, '2026-09-01', 'approved', ['Bathing', 'Dressing']]);
  }

  console.log('\n== Hardening (after review) ==');
  // Two deliveries of the same fax at the same moment -> one row.
  const raceBuf = Buffer.concat([sample('molina-authorization-rosa-delgado.pdf'), Buffer.from('\n%race-test\n')]);
  const [ra, rb] = await Promise.all([
    ingestDocument({ organizationId: ORG, buffer: raceBuf, source: 'fax' }),
    ingestDocument({ organizationId: ORG, buffer: raceBuf, source: 'fax' }),
  ]);
  eq('simultaneous duplicates end up as one document', ra.id, rb.id);
  check('  ...and one of them is flagged as the duplicate', Boolean(ra.duplicateOf) !== Boolean(rb.duplicateOf));
  eq('  ...only one row in the database', Number((await queryOne(`SELECT count(*)::int AS n FROM incoming_documents WHERE organization_id = $1 AND id = $2`, [ORG, ra.id])).n), 1);

  // A read interrupted mid-way (server restart) is left in 'processing'.
  await query(`UPDATE incoming_documents SET status = 'processing', processing_started_at = now() WHERE organization_id = $1 AND id = $2`, [ORG, ra.id]);
  let d = await db.getIncomingDocument(ORG, ra.id);
  eq('a document being read right now is not "stuck"', d.stuck, false);
  eq('  ...and can\'t be read a second time at once', (await processDocument(ORG, ra.id)).ok, false);
  await query(`UPDATE incoming_documents SET processing_started_at = now() - interval '11 minutes' WHERE organization_id = $1 AND id = $2`, [ORG, ra.id]);
  d = await db.getIncomingDocument(ORG, ra.id);
  eq('after 10 minutes it counts as interrupted', d.stuck, true);
  eq('  ...and reading it again works', (await processDocument(ORG, ra.id)).ok, true);
  eq('  ...ending in needs_review', (await db.getIncomingDocument(ORG, ra.id)).status, 'needs_review');
  await query(`UPDATE incoming_documents SET status = 'processing', processing_started_at = now() - interval '11 minutes' WHERE organization_id = $1 AND id = $2`, [ORG, ra.id]);
  await db.rejectIncomingDocument(ORG, ra.id, { reason: 'QA: interrupted', reviewer: { userId: 'u1', name: 'QA' } });
  eq('an interrupted document can be rejected', (await db.getIncomingDocument(ORG, ra.id)).status, 'rejected');
  let rejErr = null;
  try { await db.rejectIncomingDocument(ORG, ra.id, { reason: 'again', reviewer: {} }); } catch (e) { rejErr = e; }
  check('rejecting twice gives a message meant for people', rejErr?.userFacing === true, rejErr?.message);
  const again2 = await ingestDocument({ organizationId: ORG, buffer: raceBuf, source: 'fax' });
  check('after rejection, the same file can be filed again', again2.ok && !again2.duplicateOf);

  // Parser fixes
  eq('two-digit birth year in the past: 1900s', normalizeDate('04/12/41', { past: true }), '04/12/1941');
  eq('two-digit birth year that could be this century stays', normalizeDate('04/12/19', { past: true }), '04/12/2019');
  eq('"Member #: 123…" is not taken as the client name', fieldsFromText('Member #: 123456789\nMember Name: Jane Q Test').clientName?.value, 'Jane Q Test');
  const child = validateFields({ clientName: { value: 'A B', confidence: 1 }, dob: { value: '01/01/2020', confidence: 1 } }, { checkConfidence: false });
  check('a child\'s birth date is flagged (warning, not an error)', (child.dob || []).some((i) => i.level === 'warn') && !(child.dob || []).some((i) => i.level === 'error'));

  // Sample faxes only on demo servers in production
  eq('sample faxes on in development', sampleFaxesEnabled({ NODE_ENV: 'development' }), true);
  eq('sample faxes off in production by default', sampleFaxesEnabled({ NODE_ENV: 'production' }), false);
  eq('  ...on with ALLOW_SAMPLE_FAXES=true', sampleFaxesEnabled({ NODE_ENV: 'production', ALLOW_SAMPLE_FAXES: 'true' }), true);
}

run().then(async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`FAX INTAKE RESULT: ${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  - ' + f));
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}).catch(async (e) => { console.error('\nHARNESS ERROR:', e); await pool.end(); process.exit(2); });
