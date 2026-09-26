# Deploying Athleone on Google Cloud

Everything runs in one Google Cloud project, in one US region, under one Google
BAA:

| Part | Google service |
|---|---|
| The app | **Cloud Run**: scales to zero when idle, HTTPS included |
| Database | **Cloud SQL for PostgreSQL 16**: daily backups + point-in-time recovery |
| Fax files | **Cloud Storage**: private bucket |
| Passwords and keys | **Secret Manager** |
| Reading faxes | **Document AI** (see `docs/FAX-INTAKE.md`) |
| Building the image | **Cloud Build** + **Artifact Registry** |

The app gets its permissions through its own service account
(`athleone-run@…`). There is **no key file anywhere** in production.

Rough cost at demo scale: **$15–35/month**. The smallest Cloud SQL instance is
most of it; Cloud Run is close to free while idle; Document AI is billed per
page. Set a budget alert (Billing → Budgets) on day one.

---

## 1. Before you start (in the Google Cloud console)

1. Create a project (e.g. `athleone-prod`) and **turn on billing**.
2. **Accept the HIPAA Business Associate Amendment** for the billing account
   / organization before any real client data goes in.
3. Create the Document AI processor and copy its Processor ID. This is
   optional for the first deploy, which can start in demo mode. See
   `docs/FAX-INTAKE.md` §1.

## 2. First deploy: one command

The easiest place to run it is **Cloud Shell** (the `>_` icon at the top of the
console). It already has `gcloud` and is signed in as you.

Get the code into Cloud Shell:

```bash
# from GitHub (private repos work — Cloud Shell asks you to sign in)
git clone https://github.com/YOU/hearth-intake-app.git && cd hearth-intake-app
# …or: Cloud Shell menu (⋮) → Upload → a zip of hearth-intake-app, then unzip it
```

Run the setup:

```bash
PROJECT_ID=athleone-prod REGION=us-central1 bash deploy/gcp/setup.sh
```

To switch on real fax reading in the same run:

```bash
PROJECT_ID=athleone-prod DOCAI_PROVIDER=google DOCAI_PROCESSOR_ID=abc123 bash deploy/gcp/setup.sh
```

It takes about 20 minutes the first time. Creating the database is the slow
part. What it does, in order:

1. Turns on the services and creates the `athleone-run` service account,
   with only these roles: Cloud SQL client and Document AI user; read access
   to its own three secrets only; create and read (not delete) on its own
   bucket.
2. Creates a private bucket for fax files, with public access blocked.
3. Creates the Cloud SQL Postgres instance (backups at 08:00 UTC,
   point-in-time recovery), the database and a user with a random password.
4. Stores `DATABASE_URL`, `SESSION_SECRET` and `EVV_CREDENTIALS_KEY` in Secret
   Manager (generated; never printed).
5. Builds the image with Cloud Build.
6. Runs the database migrations as a Cloud Run **job**, then deploys the
   **service** and sets `APP_BASE_URL` to its address.

At the end it prints the address, e.g. `https://athleone-abc123-uc.a.run.app`.

> Re-running the script is safe: it keeps existing secrets, data and any
> settings you added later (email/SMS keys, real fax reading), and only fills
> in what's missing.

## 3. Create your admin account, load demo data

```bash
# your Athleone staff (platform admin) login
PROJECT_ID=athleone-prod bash deploy/gcp/run-script.sh create-platform-admin.mjs \
  --email=you@yourdomain.com --name="Your Name" --password="a long passphrase"

# demo agency + demo logins — ONLY on a demo project (it wipes users)
PROJECT_ID=athleone-prod bash deploy/gcp/run-script.sh seed.mjs --yes-reset-demo-data
```

These run as one-off Cloud Run job executions against the real database.
Command-line arguments are visible in the job's history, so change that
password after your first sign-in. Don't use `|` in it (the script uses `|`
to separate arguments). Once email is connected, you can also use
"Forgot password?".

## 4. Deploying updates

```bash
PROJECT_ID=athleone-prod bash deploy/gcp/deploy.sh
```

This builds a new image, runs pending migrations, then rolls the service onto
it. If a migration fails, the old version keeps running. Rollback: Cloud Run
→ athleone → Revisions → send 100% of traffic to the previous one.

## 5. Real fax reading, email and texting

**Document AI:** redeploy with
`DOCAI_PROVIDER=google DOCAI_PROCESSOR_ID=… bash deploy/gcp/deploy.sh`.
The service account already has Document AI access, so no key is needed.

**Email / SMS keys:** store each key as a secret, then attach it:

```bash
printf '%s' 'SG.xxxxx' | gcloud secrets create athleone-sendgrid-key --data-file=-
gcloud secrets add-iam-policy-binding athleone-sendgrid-key \
  --member serviceAccount:athleone-run@athleone-prod.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
gcloud run services update athleone --region us-central1 \
  --update-env-vars EMAIL_PROVIDER=sendgrid,EMAIL_FROM="Athleone <no-reply@yourdomain.com>" \
  --update-secrets SENDGRID_API_KEY=athleone-sendgrid-key:latest
```

Twilio works the same way: `SMS_PROVIDER=twilio`, `TWILIO_FROM_NUMBER` as
env vars, and `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` as secrets. Then open
**Communications** in the app and send a test.

> Google Cloud blocks outgoing SMTP on port 25; ports 587/465 work. SendGrid,
> Postmark and Resend send over HTTPS and aren't affected.

**Before real clients:** switch off the sample-fax buttons (the setup
turned them on for demos):

```bash
gcloud run services update athleone --region us-central1 --update-env-vars ALLOW_SAMPLE_FAXES=false
```

## 6. Your own domain (optional)

Cloud Run → athleone → **Manage custom domains** → add
`app.youragency.com`, then create the DNS record it shows. Afterwards:

```bash
gcloud run services update athleone --region us-central1 --update-env-vars APP_BASE_URL=https://app.youragency.com
```

Also update the Twilio and DocuSign webhook addresses and the fax provider
webhook to the new domain.

## 7. Phone app

Build the Android APK with the Cloud Run address (or your domain) as
`server_url`; see `mobile/README.md`.

## Settings the setup script applies (and why)

| Setting | Why |
|---|---|
| `--no-cpu-throttling` | Keeps the CPU on after a response, so background work finishes: reading a fax that arrived by webhook, sending a reset email. |
| `--min-instances 0` | Costs nothing while idle; the first visit after a quiet spell takes a few seconds. Use `MIN_INSTANCES=1` for real use (about $10–15/month more). |
| `STORAGE_DRIVER=gcs` | Cloud Run's disk is wiped on restart. The app refuses to start on Cloud Run without this. |
| Secrets via `--set-secrets` | Values never appear in the service's configuration or logs. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Cloud Build: `permission denied` pushing the image | Give the Cloud Build service account **Artifact Registry Writer** (IAM → the `…@cloudbuild.gserviceaccount.com` or the default compute account). |
| `Invalid tier for edition` creating Cloud SQL | Run with `DB_TIER=db-custom-1-3840`. |
| App says `CONFIG ERROR` in Logs | A required secret or setting is missing. The log line names it. |
| Fax Inbox says "missing DOCAI_PROCESSOR_ID" | Redeploy with `DOCAI_PROVIDER=google DOCAI_PROCESSOR_ID=…`. |
| Document AI `403` | The processor is in a different project, or the `athleone-run` account lacks **Document AI API User**. |
| Logs | Cloud Run → athleone → **Logs** (or `gcloud run services logs read athleone --region us-central1`). |
