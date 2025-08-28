if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.getRegistration().then(registrations => {
            if (!registrations) {
                navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then(
                    function (registration) {
                        // Registration was successful
                        console.log('ServiceWorker registration successful with scope: ', registration.scope)
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
