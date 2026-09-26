# Deploying Athleone on DigitalOcean

Two ways to run Athleone on DigitalOcean. **Option A is the one to use for the
client demo.** It costs about $12/month, runs on one server you control, and
gets HTTPS on its own. Option B (App Platform) is for later, when you'd rather
DigitalOcean run the servers for you.

| | Option A: Droplet + Docker | Option B: App Platform |
|---|---|---|
| Monthly cost | ~$12 (2 GB Droplet) | ~$5 app + $7–15 database |
| HTTPS | Automatic (Caddy + Let's Encrypt) | Automatic |
| Database | Postgres in Docker on the same server (+ nightly backup script) | DigitalOcean Managed Postgres |
| Deploying an update | `bash deploy/update.sh` | Push to GitHub |
| Best for | Demos, first client | Several paying agencies |

---

## Option A — one Droplet (recommended for the demo)

### 1. Create the Droplet

1. DigitalOcean → **Create → Droplets**.
2. Image: **Ubuntu 24.04 LTS**. Size: **Basic, Regular, 2 GB / 1 CPU** (the
   build needs about 1.5 GB of memory; 1 GB Droplets run out during
   `next build`).
3. Region: one near Texas (e.g. **NYC** or **SFO**; DigitalOcean has no Texas
   region).
4. Authentication: **SSH key** (recommended), or a password.
5. Create it, then copy its **IPv4 address**, e.g. `203.0.113.10`.

### 2. Pick the address

- **With a domain** (e.g. `app.youragency.com`): in your DNS provider add an
  **A record** pointing at the Droplet's IP. Wait a few minutes.
- **No domain yet:** use `203-0-113-10.sslip.io` (your IP, dots → dashes, plus
  `.sslip.io`). It points at your IP automatically and still gets a real HTTPS
  certificate. The setup script suggests this for you.

### 3. Put the code on the Droplet

From your Mac, in the folder that contains `hearth-intake-app`:

```bash
# Option 1 — copy straight from your Mac (no GitHub needed)
rsync -av --exclude node_modules --exclude .next --exclude .env \
  hearth-intake-app/ root@203.0.113.10:/opt/hearth/

# Option 2 — if the code is on GitHub
ssh root@203.0.113.10
git clone https://github.com/YOU/hearth-intake-app.git /opt/hearth
```

### 4. Run the setup script

```bash
ssh root@203.0.113.10
cd /opt/hearth
sudo bash deploy/setup-droplet.sh
```

The script:

- installs Docker;
- opens only ports 22, 80 and 443;
- asks for your domain (or accepts the suggested sslip.io address);
- writes `.env.production` with new random secrets;
- builds and starts Athleone, Postgres and Caddy;
- runs the database migrations.

The first build takes 3–5 minutes. When it finishes it prints
`Athleone is up: https://…`.

> **Back up `EVV_CREDENTIALS_KEY`** from `/opt/hearth/.env.production`
> somewhere safe (a password manager). If it's lost, saved DocuSign and EVV
> credentials can't be decrypted and each agency has to re-enter them.

### 5. Load the demo data (demo server only)

This **wipes** users and demo data, so only run it on a demo server:

```bash
docker compose --env-file .env.production exec app \
  node scripts/seed.mjs --yes-reset-demo-data
```

The demo logins are the same as locally (`admin@hearth.demo` / `admin123`,
and so on). **Change them before a real agency uses the server.**

### 6. Create your platform admin (Athleone staff account)

```bash
docker compose --env-file .env.production exec app \
  node scripts/create-platform-admin.mjs --email=you@yourdomain.com --name="Your Name" --password="a-long-passphrase"
```

Sign in at `https://<your address>/login` and you land on `/platform`, where
you can onboard agencies.

### 7. Nightly backups

```bash
echo "15 3 * * * root bash /opt/hearth/deploy/backup.sh" | sudo tee /etc/cron.d/hearth-backup
```

Backups go to `/var/backups/hearth` and are kept for 14 days. They contain PHI,
so keep them on the server or in encrypted storage. Also turn on **Droplet
Backups** in the DigitalOcean control panel (weekly whole-server snapshots,
+20%).

### Everyday commands (run in `/opt/hearth`)

```bash
bash deploy/update.sh                                        # deploy new code (backs up first)
docker compose --env-file .env.production logs -f app        # watch the app log
docker compose --env-file .env.production restart app        # restart after editing .env.production
docker compose --env-file .env.production ps                 # what's running
docker compose --env-file .env.production exec app node scripts/migrate.mjs --status
```

---

## Connecting email, texting and DocuSign

Edit `/opt/hearth/.env.production`, then restart:
`docker compose --env-file .env.production up -d`.
Afterwards, sign in as an agency admin, open **Communications**, and use
**Send test email** / **Send test text**.

### Email — pick one provider

| Provider | Set these | Notes |
|---|---|---|
| **SendGrid** | `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `EMAIL_FROM` | Verify your sender/domain in SendGrid first |
| **Postmark** | `EMAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` | Best deliverability for sign-in email |
| **Resend** | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Simple setup |
| **Any SMTP** (Microsoft 365, Google Workspace, Mailgun, Amazon SES) | `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Port 587 (or 465 with `SMTP_SECURE=true`) |

`EMAIL_FROM` has to be an address on a domain the provider has verified, e.g.
`"Athleone <no-reply@youragency.com>"`.

> DigitalOcean blocks outgoing SMTP on ports 25/465/587 for new accounts.
> SendGrid, Postmark and Resend send over HTTPS and aren't affected. For SMTP,
> ask DigitalOcean support to unblock it.

### Text messages — Twilio

1. In Twilio, buy a phone number (or create a Messaging Service). US numbers
   need **A2P 10DLC registration** before carriers deliver texts reliably;
   start it early, it takes days.
2. Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
   `TWILIO_FROM_NUMBER=+1…` (or `TWILIO_MESSAGING_SERVICE_SID=MG…`).
3. So caregivers can **text in**: Twilio → Phone Numbers → your number →
   Messaging → "A message comes in" → Webhook, **HTTP POST**:
   `https://<your address>/api/webhooks/twilio/sms`
4. Delivery receipts (sent → delivered) work automatically once `APP_BASE_URL`
   is https.

### DocuSign

DocuSign is set up **per agency** inside Athleone, not in `.env.production`:
sign in as the agency admin → **E-Signature** → enter the Integration Key, API
user, account ID and RSA private key → **Test connection**. For automatic
"signed" updates, follow the **DocuSign Connect** steps on the same page. It
shows the exact URL to paste into DocuSign.

For the demo, use a free DocuSign developer account (`developers.docusign.com`).
Production needs DocuSign's go-live review of your integration key, plus a
signed BAA before any document with client information is sent.

---

## Option B — App Platform (managed)

1. Push `hearth-intake-app` to a GitHub repository.
2. Edit `.do/app.yaml`: replace `YOUR-GITHUB-USER/hearth-intake-app` (twice).
3. DigitalOcean → **Apps → Create App → GitHub**, pick the repo, then
   **Edit App Spec** and paste in `.do/app.yaml`. (With the CLI:
   `doctl apps create --spec .do/app.yaml`.)
4. In the app's **Settings → Environment Variables**, set real values for
   `SESSION_SECRET` and `EVV_CREDENTIALS_KEY` (`openssl rand -hex 32` each),
   plus any email/SMS keys.
5. Deploy. The `migrate` job runs `scripts/migrate.mjs` before every release.
6. Create the platform admin from the app's **Console** tab:
   `node scripts/create-platform-admin.mjs --email=… --name=… --password=…`

For real agency data, change the database component to a **production**
Managed Postgres cluster (daily backups, point-in-time recovery). DigitalOcean
will sign a BAA for HIPAA workloads on eligible plans; confirm it's in place
before real client data goes in.

---

## Before real client data (not needed for the demo)

- [ ] Remove or change every demo login (`npm run db:seed` accounts).
- [ ] Signed BAAs: DigitalOcean, your email provider, Twilio (if any PHI could
      reach them), DocuSign.
- [ ] Turn on **Require two-step sign-in** for office staff (Settings), after
      email is connected.
- [ ] Nightly backups running, plus one test restore.
- [ ] `EVV_CREDENTIALS_KEY` stored somewhere safe, outside the server.
- [ ] Uptime monitor pointed at `https://<address>/api/health`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| App container keeps restarting; log says `CONFIG ERROR` | A required variable is missing or too short. The log names it. Fix `.env.production`, then run `docker compose --env-file .env.production up -d`. |
| Caddy log: `no such host` / certificate errors | The DNS A record doesn't point at the Droplet yet, or the domain is wrong in `.env.production`. |
| Signing in just returns to the login page | You're on plain `http://`. Use the https address. (Only for a throwaway http demo: `COOKIE_SECURE=false`.) |
| "Forgot password" emails never arrive | `APP_BASE_URL` isn't set, or email is still `log`. Check **Communications** and the app log. |
| `next build` killed during `docker compose up --build` | The Droplet has too little memory. Use a 2 GB Droplet, or add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
