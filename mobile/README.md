# Hearth caregiver app: Android APK (and the no-APK option)

Caregivers can get Hearth on their phone in two ways.

## 1. Install from the website (no APK, works today)

Once Hearth is on your server (see `deploy/DEPLOY-DIGITALOCEAN.md`), a
caregiver opens `https://<your address>` on their phone and signs in.

- **Android (Chrome):** a green "Add Hearth to your home screen" bar appears
  with an **Install** button. Tap it and Hearth gets its own icon. It opens
  full screen, like an app.
- **iPhone (Safari):** tap **Share → Add to Home Screen**. The bar shows this
  tip.

This is a Progressive Web App: the manifest is in `app/manifest.js` and the
service worker in `public/sw.js`. GPS for clock-in and clock-out works the
same as in an app.

## 2. The Android app (APK)

The APK is a thin native shell around your live Hearth website
([Capacitor](https://capacitorjs.com)). When it opens it loads
`https://<your address>/caregiver`. Two consequences:

- **Every server update shows up in the app right away.** You only rebuild the
  APK to change the server address, icon or app name.
- **The server has to be up and on https** (Option A in the deploy guide gives
  you that).

### Build it on GitHub (easiest — no Android Studio)

1. Put `hearth-intake-app` in a GitHub repository (private is fine).
2. On GitHub, open the repo → **Actions** → **Android APK** →
   **Run workflow**.
3. **server_url:** your Hearth address, e.g. `https://203-0-113-10.sslip.io`.
4. When the run finishes (~5 minutes), download the
   **hearth-android-N** artifact. It's a zip containing `app-debug.apk`.

Installing on a phone: send the APK to the phone (email, Google Drive), tap it,
and allow **Install unknown apps** when Android asks. A *debug* APK is fine for
demos and testing. For the Play Store you need a signed release (below).

### Build it on your Mac (Android Studio)

```bash
# once: install Android Studio from developer.android.com and open it once
cd hearth-intake-app/mobile
npm install
HEARTH_SERVER_URL=https://203-0-113-10.sslip.io npx cap sync android
npx cap open android        # opens Android Studio
```

In Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, or
plug in a phone with USB debugging on and press **Run ▶**.

### What's in this folder

| Path | What it is |
|---|---|
| `capacitor.config.js` | App id, name, server address (`HEARTH_SERVER_URL`), which hosts may open inside the app |
| `www/` | Splash and offline pages shown only if the server can't be reached |
| `android/` | The generated Android Studio project. Location permission is added and backups are off (so PHI never goes into Google backups) |
| `../.github/workflows/android-apk.yml` | The GitHub build |
| `../scripts/generate-icons.mjs` | Regenerates app icons and splash screens from `public/icons/*.svg` |

### Signed release / Play Store (later)

1. Create a keystore once and keep it safe. If it's lost, you can never update
   the app on the Play Store.
   ```bash
   keytool -genkey -v -keystore hearth.keystore -alias hearth -keyalg RSA -keysize 2048 -validity 10000
   ```
2. GitHub repo → **Settings → Secrets and variables → Actions**, add:
   `HEARTH_KEYSTORE_BASE64` (output of `base64 -i hearth.keystore`),
   `HEARTH_KEYSTORE_PASSWORD`, `HEARTH_KEY_ALIAS` (`hearth`),
   `HEARTH_KEY_PASSWORD`.
3. Run the workflow again. The artifact then also contains a signed
   `app-release.apk` and `app-release.aab` (upload the `.aab` to Google Play).

The Play Store also needs a privacy policy URL and a data-safety form. The app
collects location during visits and handles health information.

### iPhone app (later)

The same Capacitor project can produce an iOS app
(`npm i @capacitor/ios && npx cap add ios`). Building it needs a Mac with Xcode
and an Apple Developer account ($99/yr). Until then, iPhone caregivers use
option 1 (Add to Home Screen).
