// Version identifier - increment to force service worker update
const SW_VERSION = 'v1.7'

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
        event.request.url.includes('/googleOAuthCallback')
    ) {
        return
    }

    event.respondWith(
        fetch(event.request)
            .catch(function () {
                return caches.match(event.request)
            })
            .then(function (response) {
                // Ensure we always return a valid Response object
                if (response && response.ok) {
                    return response
                }
                // If no cache match, return a basic response to avoid errors
                return caches.match(event.request).then(function (cachedResponse) {
                    return (
                        cachedResponse ||
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
