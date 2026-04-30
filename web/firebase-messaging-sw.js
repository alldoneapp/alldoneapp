// Give the service worker access to Firebase Messaging.
// Note that you can only use Firebase Messaging here. Other Firebase libraries
// are not available in the service worker.

importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js')
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js')

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
// https://firebase.google.com/docs/web/setup#config-object
firebase.initializeApp({
    apiKey: '__FIREBASE_API_KEY__',
    authDomain: '__FIREBASE_AUTH_DOMAIN__',
    databaseURL: '__FIREBASE_DATABASE_URL__',
    projectId: '__FIREBASE_PROJECT_ID__',
    storageBucket: '__FIREBASE_STORAGE_BUCKET__',
    messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
    appId: '__FIREBASE_APP_ID__',
    measurementId: '__FIREBASE_MEASUREMENT_ID__',
})

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim())
})

if (firebase.messaging.isSupported()) {
    const messaging = firebase.messaging()

    const getNotificationUrl = notification => {
        try {
            const url = notification && notification.data && notification.data.url
            return url ? new URL(url, self.location.origin).href : self.location.origin
        } catch (_) {
            return self.location.origin
        }
    }

    const openWindow = url => {
        return clients.openWindow(url).catch(() => clients.openWindow(self.location.origin))
    }

    const navigateAndFocusClient = async (client, url) => {
        try {
            const navigatedClient = 'navigate' in client ? await client.navigate(url) : client
            const targetClient = navigatedClient || client
            return targetClient && 'focus' in targetClient ? targetClient.focus() : targetClient
        } catch (_) {
            try {
                return 'focus' in client ? client.focus() : client
            } catch (_) {
                return null
            }
        }
    }

    const openOrFocusNotificationUrl = async url => {
        const targetUrl = new URL(url, self.location.origin)
        const windowClients = await clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        })

        const sameOriginClient = windowClients.find(client => {
            try {
                return targetUrl.origin === self.location.origin && new URL(client.url).origin === self.location.origin
            } catch (_) {
                return false
            }
        })

        if (sameOriginClient) {
            const focusedClient = await navigateAndFocusClient(sameOriginClient, targetUrl.href)
            if (focusedClient) return focusedClient
        }

        return openWindow(targetUrl.href)
    }

    messaging.setBackgroundMessageHandler(payload => {
        const options = {
            body: payload.data.body,
            icon: '/apple-touch-icon-57x57.png',
            data: {
                url: payload.data.link,
            },
        }
        return self.registration.showNotification(payload.data.type, options)
    })

    self.addEventListener('notificationclick', function (event) {
        const clickedNotification = event.notification
        if (clickedNotification) clickedNotification.close()
        const promiseChain = openOrFocusNotificationUrl(getNotificationUrl(clickedNotification)).catch(() =>
            openWindow(self.location.origin)
        )
        event.waitUntil(promiseChain)
    })
}
