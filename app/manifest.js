// Web app manifest — lets caregivers "Install" Hearth to their home screen
// from Chrome (Android) or Safari → Share → Add to Home Screen (iPhone), and
// is what the Android APK wrapper (mobile/) is built around.
export default function manifest() {
  return {
    name: 'Hearth',
    short_name: 'Hearth',
    description: 'Visits, EVV clock-in/out and messages for home-care caregivers.',
    id: '/caregiver',
    start_url: '/caregiver',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f4',
    theme_color: '#23776d',
    categories: ['medical', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
