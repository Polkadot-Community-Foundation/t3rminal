'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.location.pathname.startsWith('/__pwa_product__/')) {
      console.info('Service Worker registration skipped inside hosted product frame');
      return;
    }

    let serviceWorker: ServiceWorkerContainer | null = null;
    try {
      serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    } catch (error) {
      console.info('Service Worker registration skipped:', error);
      return;
    }

    if (serviceWorker == null) {
      console.log('Service Workers are not supported in this browser');
      return;
    }

    // In dev, an SW controller will pin stale chunks across HMR rebuilds and
    // re-serve them after a hard reload, which masks code changes. Skip
    // registration in dev and proactively unregister any previous SW + caches
    // so the page picks up fresh bundles from the dev server.
    if (process.env.NODE_ENV !== 'production') {
      serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if ('caches' in window) {
        caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
      }
      return;
    }

    try {
      serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('Service Worker registered successfully:', registration);
          setInterval(() => { registration.update(); }, 60000);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });

      let refreshing = false;
      serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    } catch (error) {
      console.info('Service Worker registration skipped:', error);
    }
  }, []);

  return null;
}
