if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.getRegistration().then(registrations => {
            if (!registrations) {
                navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(
                    function () {
                        // Registration was successful — nothing to report. This file is copied in
                        // as-is rather than bundled, so it has no __DEV__ to gate a log behind.
                    },
                    function (err) {
                        // registration failed :(
                        console.log('ServiceWorker registration failed: ', err)
                    }
                )
            }
        })
    })
}
