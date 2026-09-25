import "./globals.css";
import PwaSetup from "@/components/PwaSetup";

export const metadata = {
  title: "Hearth",
  description:
    "IHSS caregiver-agency app — referral intake, admin scheduling/EVV compliance, and a caregiver mobile app, backed by Postgres with real per-role login.",
  appleWebApp: { capable: true, title: "Hearth", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

// Phone-friendly defaults: fill the whole screen (including under the notch —
// the caregiver app pads for safe areas itself) and color the status bar.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#23776d",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded client-side so the build never depends on network access;
            falls back to the system font stack below if it can't load. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Karla:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}
