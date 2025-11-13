self.addEventListener('install', function (event) {
    // Perform install steps
    console.log('Service Worker installed')
})

self.addEventListener('fetch', function (event) {
    // Skip non-GET requests and external API calls
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('firebasestorage.googleapis.com') ||
        event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('accounts.google.com') ||
        event.request.url.includes('googleapis.com')
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

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (cacheNames) {
            return Promise.all(
                cacheNames
                    .filter(function (cacheName) {
                        // Return true if you want to remove this cache,
                        // but remember that caches are shared across
                        // the whole origin
                    })
                    .map(function (cacheName) {
                        return caches.delete(cacheName)
                    })
            )
        })
    )
})
