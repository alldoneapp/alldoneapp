// A single browser wake lock is shared by all active microphone features. A call and a dictation
// can overlap; stopping either one must not let the screen sleep while the other is still active.
const owners = new Set()
let sentinel = null
let pending = false
let generation = 0

const isVisible = () => typeof document !== 'undefined' && document.visibilityState !== 'hidden'
function releaseLock(lock) {
    try {
        Promise.resolve(lock.release()).catch(() => {})
    } catch (_) {
        // Browsers may throw synchronously while navigating away.
    }
}

function releaseSentinel() {
    generation += 1
    const current = sentinel
    sentinel = null
    if (current) releaseLock(current)
}

function requestIfNeeded() {
    if (!owners.size || !isVisible() || sentinel || pending || typeof navigator === 'undefined') return
    if (typeof navigator.wakeLock?.request !== 'function') return

    const requestGeneration = ++generation
    pending = true
    Promise.resolve()
        .then(() => navigator.wakeLock.request('screen'))
        .then(lock => {
            pending = false
            if (generation !== requestGeneration || !owners.size || !isVisible()) {
                releaseLock(lock)
                requestIfNeeded()
                return
            }
            sentinel = lock
            lock.addEventListener?.('release', () => {
                if (sentinel === lock) sentinel = null
            })
        })
        .catch(() => {
            // Unsupported, denied or unavailable (for example low battery): recording continues.
            pending = false
            if (generation !== requestGeneration) requestIfNeeded()
        })
}

function onVisibilityChange() {
    if (isVisible()) requestIfNeeded()
    else releaseSentinel()
}

/** Keep the screen awake until the returned idempotent function is called. */
export function keepScreenAwake() {
    const owner = Symbol('screen wake lock owner')
    owners.add(owner)
    if (owners.size === 1 && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange)
    }
    requestIfNeeded()

    return () => {
        if (!owners.delete(owner)) return
        if (owners.size) return
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
        releaseSentinel()
    }
}
