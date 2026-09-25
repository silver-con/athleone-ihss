'use client';

import { useEffect } from 'react';

// Registers the service worker (public/sw.js) in production builds.
export default function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
