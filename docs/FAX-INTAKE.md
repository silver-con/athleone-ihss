# Fax Inbox: faxes in, fields filled, a person approves

Referral and authorization faxes arrive in **Fax Inbox** (`/inbox`). Athleone
reads each one and fills in the referral fields. A coordinator checks the
fields against the fax, side by side, and clicks **Approve**, which creates
the referral. Nothing reaches referrals or clients without that approval. A
misread authorization is a billing and compliance error, so the human review
step is deliberate.

```
fax provider ──webhook──▶ /api/webhooks/fax ─┐
coordinator  ──upload───▶ /inbox/upload ─────┼─▶ stored (lib/storage.js) ─▶ read (lib/docai) ─▶ Needs review
"Try a sample fax" ──────────────────────────┘                                                      │
                                                     Approve ─▶ referral (+ fax linked) ─▶ intake ◀─┘
```

## What each part does

| Piece | File |
|---|---|
| Inbox list, upload, sample faxes, fax-line settings | `app/(dashboard)/inbox/page.js` |
| Review screen (original on the left, fields on the right) | `app/(dashboard)/inbox/[id]/page.js`, `components/intake/ReviewForm.js` |
| Store → read → save pipeline | `lib/intake.js` |
| Reading engines | `lib/docai/` — `google.js` (Google Document AI), `demo.js` (typed PDFs, no account) |
| Turning engine output into fields | `lib/docai/parse.js`, field list in `lib/docai/fields.js` |
| Checks (Medicaid ID, dates, hours, required fields) | `lib/docai/validate.js` |
| Duplicate check (same Medicaid ID, name + DOB, or auth #) | `findIntakeDuplicates` in `lib/queries.js` |
| Inbound fax webhook | `app/api/webhooks/fax/route.js` |
| File storage (your disk, or Google Cloud Storage) | `lib/storage.js` |

After approval, the referral's **Start Intake** form is pre-filled with the
Medicaid ID, address, phone and authorization dates from the fax.

## Reading engines

`DOCAI_PROVIDER` picks the engine:

- **`demo`** (default): reads **typed** PDFs (like the three sample faxes)
  on your own machine. Needs no account. It can't read a scanned fax. Use it
  to try the workflow and in demos.
- **`google`**: **Google Document AI**. Reads real faxes, scans and phone
  photos.

## Turning on real mode: Google Document AI

### 1. Create the reader (processor)

In Google Cloud Console → **Document AI** → **Create processor**, choose
**Custom Extractor**, region **US**, and name it `athleone-referral-extractor`.

Add these fields to its schema, all **optional**, **once** per document. Use
exactly these names; Athleone maps them automatically:

| Field name | Type | Description to give it (helps the AI) |
|---|---|---|
| `client_name` | Plain text | The member / patient / client's full name |
| `date_of_birth` | Datetime | The member's date of birth |
| `medicaid_id` | Plain text | Texas Medicaid ID (9 digits); may be labelled Member ID |
| `payer_name` | Plain text | Health plan or payer, e.g. Molina, Superior, Amerigroup |
| `authorization_number` | Plain text | Authorization, referral or prior-auth number |
| `service_type` | Plain text | Service authorized, e.g. Personal Attendant Services |
| `procedure_code` | Plain text | HCPCS code and modifier, e.g. S5125 U5 |
| `authorized_hours` | Plain text | Hours or units authorized, with the period (per week/day) |
| `auth_start_date` | Datetime | First day the authorization is effective |
| `auth_end_date` | Datetime | Last day the authorization is effective |
| `diagnosis` | Plain text | Diagnosis or reason for services |
| `client_address` | Plain text | The member's home address |
| `client_phone` | Plain text | The member's phone number |

Then use the processor's **test** screen on a few real faxes (the sample
faxes work too), and **deploy/set a default version** if the console asks.
Copy the **Processor ID** from the processor's details page.

> Any processor type works. With a **Form Parser** or **Document OCR**
> processor, Athleone falls back to reading printed labels ("Member Name:",
> "DOB", "Authorization #"…). The Custom Extractor is more accurate on the
> varied letter layouts health plans send.

### 2. Settings

On your Mac (`.env`), use a service-account key with the role
**Document AI API User**. Keep the key file outside the project folder:

```bash
DOCAI_PROVIDER=google
GOOGLE_CLOUD_PROJECT=your-project-id
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=abcdef1234567890
GOOGLE_APPLICATION_CREDENTIALS=/Users/najam/PrivateKeys/athleone-docai.json
```

On Google Cloud Run you leave out `GOOGLE_APPLICATION_CREDENTIALS`: the
service's own identity is used, and there's no key file at all. See
`deploy/DEPLOY-GOOGLE-CLOUD.md`.

Restart `npm run dev`. The Fax Inbox banner changes to **Google Document
AI**. Upload a real fax (a photo taken on your phone works too) and check the
fields.

### 3. HIPAA

Before any real client document goes in, accept Google Cloud's **Business
Associate Amendment** in the console. Document AI and Cloud Storage are
covered services; keep everything in one US region.

## Connecting a real fax line

Pick a HIPAA fax service that signs a BAA and can **POST each incoming fax to
a webhook**. Examples include SRFax, Documo (mFax), Sfax, iFax and Phaxio;
check each one's current plans for webhook support. Then:

1. Sign in as the agency **admin** → **Fax Inbox** → **Connect a fax line**
   → **Generate secret**. Copy it; it's shown once.
2. In the fax service, set incoming faxes to be sent to the **webhook
   address** shown there (HTTP POST), with the header
   `Authorization: Bearer <secret>`. If the service can't add headers, append
   `&token=<secret>` to the address. That works, but web addresses are
   written to request logs (yours and the provider's), so prefer the header,
   and generate a new secret if the logs are ever shared.
3. Send a test fax. It appears in the inbox within seconds.

The webhook accepts the fax as a multipart file (any field name) or as a raw
PDF/TIFF body. If the service sends the caller's number in a field named
`from`, `sender`, `caller_id` or `fax_from`, it's shown in the inbox. A fax
that's sent twice is only filed once.

Until then, forward faxes as PDFs and **upload** them, or drag them onto the
inbox.

## Limits and safeguards

- 20 MB per file; PDF, TIFF, PNG, JPEG, GIF or WEBP. The file type is checked
  from the file's contents, not its name.
- Google's online processing handles up to about 15 pages per request, which
  is plenty for referral faxes.
- Files are stored per agency (`<agency>/incoming/<id>.pdf`), are only
  served to signed-in staff of that agency, and are never cached.
- Every upload, approval and rejection is in the Audit Log.
- The same file can only be filed once per agency: the database enforces it,
  even if the fax service delivers it twice at the same moment.
- If reading is interrupted (e.g. the server restarted mid-read), the
  document shows **Read it again** / **Reject** after 10 minutes.
- **"Try a sample fax"** is available in development. On a production server it
  is off unless `ALLOW_SAMPLE_FAXES=true` (set it on a demo server only; the
  Google Cloud setup script turns it on for a brand-new service).
