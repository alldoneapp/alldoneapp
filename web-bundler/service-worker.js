/**
 * App service worker (OFFLINE_SUPPORT_PLAN.md Stage 2). Compiled by workbox's
 * InjectManifest in webpack.config.js (production builds only — dev copies the
 * no-op service-worker.dev.js instead) and emitted as /service-worker.js, the
 * same URL the pre-workbox SW used, so existing registrations pick it up as a
 * normal SW update.
 *
 * What changed vs. the old web/service-worker.js (v1.9):
 * - The old SW deleted EVERY cache on activate and never wrote one, so its
 *   fetch fallback (`catch(() => caches.match(request))`) could not ever hit —
 *   offline was a guaranteed blank page. This SW precaches the app shell
 *   (hashed JS/CSS chunks, index.html, fonts, manifest/icons) and lets workbox
 *   clean up only *outdated* precache entries on update.
 * - Cross-origin API traffic (Firestore, googleapis, giphy, …) needed an
 *   explicit exclusion list before, because the old SW intercepted everything.
 *   Workbox only intercepts registered routes, and none below match
 *   cross-origin requests — the SDKs own their transports untouched.
 */
import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Same takeover semantics as the old SW: a new version activates immediately
// and controls all open tabs. The app's own version banner / reload flow
// (utils/Observers.js) handles getting the page onto the new bundles.
self.skipWaiting()
clientsClaim()

// Same-origin navigations the SW must never answer for. These endpoints reply
// with redirects (OAuth handshakes); intercepting a top-level navigation turns
// the 302 into an opaque-redirect response and breaks the flow — the same
// lesson the old SW's exclusion list carried for the MCP OAuth endpoints.
const NAVIGATION_DENYLIST = [
    /^\/__\/auth\//,
    /\/googleOAuthCallback/,
    /\/mcpServer/,
    /\/mcpOAuthCallback/,
    /\/mcpClientOAuthCallback/,
    /\/\.well-known\/oauth/,
]

// Navigations stay network-first (hosting serves index.html with no-cache on
// purpose — deploys land ~11×/day), falling back to the last good copy and
// finally to the precached shell, which is what makes an offline reload boot
// at all. Registered BEFORE precacheAndRoute: workbox matches routes in
// registration order, and the precache route would otherwise serve '/'
// cache-first via its directoryIndex handling.
const navigationStrategy = new NetworkFirst({
    cacheName: 'app-navigations',
    networkTimeoutSeconds: 5,
})

registerRoute(
    new NavigationRoute(
        async options => {
            try {
                return await navigationStrategy.handle(options)
            } catch (error) {
                const precachedShell = await matchPrecache('/index.html')
                if (precachedShell) return precachedShell
                throw error
            }
        },
        { denylist: NAVIGATION_DENYLIST }
    )
)

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Same-origin static assets deliberately left out of the precache (web/images
// alone is 3.3 MB) get cached on first use instead. Video stays excluded: the
// browser fetches .mp4 with Range requests, which a cached full-body response
// breaks (the same Safari issue the old SW excluded .mp4 for).
registerRoute(
    ({ url, request }) =>
        url.origin === self.location.origin &&
        request.destination !== 'video' &&
        !/\.(?:mp4|webm|mov)$/.test(url.pathname) &&
        (url.pathname.startsWith('/static/') ||
            url.pathname.startsWith('/images/') ||
            url.pathname.startsWith('/icons/') ||
            url.pathname.startsWith('/fonts/')),
    new CacheFirst({
        cacheName: 'app-static-runtime',
        plugins: [new ExpirationPlugin({ maxEntries: 200, purgeOnQuotaError: true })],
    })
)
