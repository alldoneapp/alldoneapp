self.addEventListener('install', function (event) {
    // Perform install steps
    console.log('Service Worker installed')
})

self.addEventListener('fetch', function (event) {
    event.respondWith(
        fetch(event.request).catch(function () {
            return caches.match(event.request)
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
