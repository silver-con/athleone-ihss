// Capacitor wraps the live Hearth website in a native Android app.
//
// The app loads HEARTH_SERVER_URL (your DigitalOcean address) — so every
// update you deploy to the server shows up in the app immediately, no new
// APK needed. Set it when you build:
//   HEARTH_SERVER_URL=https://203-0-113-10.sslip.io npx cap sync android
// (the GitHub workflow asks for it as an input).
//
// www/ holds a small offline/fallback page used only if the server can't be
// reached when the app opens.
const serverUrl = (process.env.HEARTH_SERVER_URL || 'https://app.example.com').replace(/\/+$/, '');

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: process.env.HEARTH_APP_ID || 'com.hearthcare.caregiver',
  appName: 'Athleone',
  webDir: 'www',
  server: {
    url: `${serverUrl}/caregiver`,
    // Only https. Our own host loads inside the app — and so does DocuSign,
    // on purpose: embedded signing then returns to Hearth inside the app,
    // still signed in. (Trade-off: DocuSign's pages run in the app's
    // WebView; no native plugins are installed, so there's nothing for them
    // to reach.) Any other link opens in the system browser.
    cleartext: false,
    allowNavigation: [new URL(serverUrl).host, '*.docusign.net', '*.docusign.com'],
    errorPath: 'offline.html',
  },
  android: {
    // Lets the website tell it's running inside the app (hides the
    // "install" banner). Appended to the normal Chrome user agent.
    appendUserAgent: 'HearthApp/1.0',
    allowMixedContent: false,
  },
};

module.exports = config;
