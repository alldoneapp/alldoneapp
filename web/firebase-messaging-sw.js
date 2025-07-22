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

if (firebase.messaging.isSupported()) {
    const messaging = firebase.messaging()

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
        clickedNotification.close()
        const promiseChain = clients.openWindow(clickedNotification.data.url)
        event.waitUntil(promiseChain)
    })
}
