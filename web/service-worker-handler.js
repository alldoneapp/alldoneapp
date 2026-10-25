if ('serviceWorker' in navigator) {
    var STALE_SHELL_RELOAD_KEY = 'alldone_stale_shell_reload_target'

    var getMainBundlePath = function (source) {
        var match = String(source || '').match(/\/static\/js\/main\.[^"']+\.js/)
        return match ? match[0] : null
    }

    var waitForWorkerActivation = function (registration) {
        var worker = registration.installing || registration.waiting
        if (!worker || worker.state === 'activated' || worker.state === 'redundant') return Promise.resolve()

        return new Promise(function (resolve) {
            var timer = setTimeout(resolve, 3000)
            worker.addEventListener('statechange', function () {
                if (worker.state === 'activated' || worker.state === 'redundant') {
                    clearTimeout(timer)
                    resolve()
                }
            })
        })
    }

    // A fully cold Chrome start can briefly reject the navigation fetch while its network stack
    // wakes. NetworkFirst correctly falls back to the offline shell, but the worker update that
    // follows cannot replace JavaScript in the already-open page. Compare hashed bundle names at
    // startup and reload ONCE after the current worker activates when hosting has a newer shell.
    // A real offline start simply fails this check and keeps the usable cached app.
    var refreshStaleBootShell = async function (registration) {
        try {
            var currentMainBundle = Array.prototype.map
                .call(document.scripts, function (script) {
                    return script.src
                })
                .map(getMainBundlePath)
                .find(Boolean)
            if (!currentMainBundle) return

            var response = await fetch('/index.html?startup-shell-check=' + Date.now(), { cache: 'no-store' })
            if (!response.ok) return
            var deployedMainBundle = getMainBundlePath(await response.text())
            if (!deployedMainBundle || deployedMainBundle === currentMainBundle) {
                sessionStorage.removeItem(STALE_SHELL_RELOAD_KEY)
                return
            }

            var reloadTarget = currentMainBundle + '->' + deployedMainBundle
            if (sessionStorage.getItem(STALE_SHELL_RELOAD_KEY) === reloadTarget) return

            await registration.update().catch(function () {})
            await waitForWorkerActivation(registration)
            sessionStorage.setItem(STALE_SHELL_RELOAD_KEY, reloadTarget)
            window.location.reload()
        } catch (error) {
            // Offline and privacy-restricted browsers keep the cached shell. This check is an
            // update accelerator, never a prerequisite for booting the app.
        }
    }

    window.addEventListener('load', function () {
        return navigator.serviceWorker
            .getRegistration()
            .then(function (registration) {
                if (registration) return registration
                return navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
            })
            .then(refreshStaleBootShell)
            .catch(function (err) {
                // This file is copied as-is, so it has no __DEV__ flag for gated diagnostics.
                console.log('ServiceWorker registration failed: ', err)
            })
    })
}
