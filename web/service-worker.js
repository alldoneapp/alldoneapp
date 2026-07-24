// Version identifier - increment to force service worker update
const SW_VERSION = 'v1.9'

self.addEventListener('install', function (event) {
    // Perform install steps
    console.log('Service Worker installed:', SW_VERSION)
    // Force the waiting service worker to become the active service worker
    self.skipWaiting()
})

self.addEventListener('activate', function (event) {
    console.log('Service Worker activated:', SW_VERSION)
    event.waitUntil(
        Promise.all([
            // Clear old caches
            caches.keys().then(function (cacheNames) {
                return Promise.all(
                    cacheNames.map(function (cacheName) {
                        return caches.delete(cacheName)
                    })
                )
            }),
            // Take control of all clients immediately
            self.clients.claim(),
            // Reload all windows to ensure they use the new SW immediately
            self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({ type: 'NEW_SW_ACTIVATED' }))
            }),
        ])
    )
})

self.addEventListener('fetch', function (event) {
    // Skip non-GET requests and external API calls
    // Also skip MP4 files to allow browser Range requests to work correctly (fixes Safari video issues)
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('.mp4') ||
        event.request.url.includes('firebasestorage.googleapis.com') ||
        event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('accounts.google.com') ||
        event.request.url.includes('googleapis.com') ||
        event.request.url.includes('apis.google.com') ||
        event.request.url.includes('googletagmanager.com') ||
        event.request.url.includes('google-analytics.com') ||
        event.request.url.includes('googleusercontent.com') ||
        event.request.url.includes('doubleclick.net') ||
        event.request.url.includes('giphy.com') ||
        event.request.url.includes('/googleOAuthCallback') ||
        // MCP server + OAuth endpoints respond with redirects (e.g. /authorize ->
        // login page). Intercepting a top-level navigation here turns the 302 into
        // an opaque-redirect response (status 0), which the logic below would
        // mistranslate into a synthetic 404 and break the MCP OAuth flow. Let the
        // browser handle these natively, exactly like /googleOAuthCallback.
        event.request.url.includes('/mcpServer') ||
        event.request.url.includes('/mcpOAuthCallback') ||
        event.request.url.includes('/mcpClientOAuthCallback') ||
        event.request.url.includes('/.well-known/oauth')
    ) {
        return
    }

    event.respondWith(
        fetch(event.request)
            .catch(function () {
                return caches.match(event.request)
            })
            .then(function (response) {
                // Pass through any response the browser can actually use. Besides
                // normal 2xx responses, this includes:
                //   - opaque responses (status 0, type "opaque"): cross-origin no-cors
                //     requests such as the Firebase SDK <script> tags loaded from
                //     www.gstatic.com on the MCP login page. These are not "ok" but
                //     are perfectly valid for the browser to execute.
                //   - opaque redirects (type "opaqueredirect"): a top-level navigation
                //     that the server answers with a 302 (e.g. /mcpServer/authorize ->
                //     login page).
                // Without this, the fallback below mistranslated them into a synthetic
                // 404 and broke the MCP OAuth flow (firebase script 404 -> "firebase is
                // not defined").
                if (
                    response &&
                    (response.ok ||
                        response.status === 0 ||
                        response.type === 'opaque' ||
                        response.type === 'opaqueredirect')
                ) {
                    return response
                }
                // Real error status: prefer a cached copy, otherwise surface the
                // original response rather than fabricating a 404.
                return caches.match(event.request).then(function (cachedResponse) {
                    return (
                        cachedResponse ||
                        response ||
                        new Response('', {
                            status: 404,
                            statusText: 'Not Found',
                        })
                    )
                })
            })
    )
})

// Remove the duplicate activate listener at the end
