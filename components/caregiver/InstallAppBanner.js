'use client';

import { useEffect, useState } from 'react';

// "Add Hearth to your home screen" for caregivers using the website on a
// phone. Android Chrome gives a real install button (beforeinstallprompt);
// iPhone Safari has no API, so it shows the Share → Add to Home Screen tip.
// Hidden when already installed (standalone) or inside the Android app.
const KEY = 'hearth-install-dismissed';

export default function InstallAppBanner() {
  const [deferred, setDeferred] = useState(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const inApp = /HearthApp/.test(navigator.userAgent);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === '1';
    } catch {}
    if (standalone || inApp || dismissed) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (isIos) {
      setIos(true);
      setHidden(false);
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    setHidden(true);
  };

  return (
    <div className="shrink-0 flex items-center gap-3 bg-[var(--accent-soft)] border-b border-[var(--border)] px-5 py-2.5">
      <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
      <div className="flex-1 text-[12px] leading-snug">
        <strong className="font-display">Add Athleone to your home screen</strong>
        <div className="text-[var(--muted)]">
          {ios ? 'Tap Share, then “Add to Home Screen”.' : 'Opens like an app — one tap to clock in.'}
        </div>
      </div>
      {!ios && deferred && (
        <button
          type="button"
          onClick={async () => {
            deferred.prompt();
            await deferred.userChoice.catch(() => null);
            setDeferred(null);
            setHidden(true);
          }}
          className="bg-[var(--accent-strong)] text-white font-display font-bold text-[12px] px-3 py-1.5 rounded-lg"
        >
          Install
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-[var(--muted)] text-[18px] leading-none px-1">
        ×
      </button>
    </div>
  );
}
