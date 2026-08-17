/**
 * Development stand-in for the workbox service worker (see service-worker.js).
 * Copied to /service-worker.js by webpack.config.js in non-production builds so
 * the registration in web/service-worker-handler.js keeps working under the dev
 * server without precaching HMR chunks. No fetch handler: everything passes
 * through to the network.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
