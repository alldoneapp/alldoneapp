import { subscribePageHidden, subscribePageVisible } from './appResume'

// A single browser wake lock is shared by all active microphone features. A call and a dictation
// can overlap; stopping either one must not let the screen sleep while the other is still active.
const owners = new Set()
let sentinel = null
let pending = false
let generation = 0
let unsubscribePageVisible = null
let unsubscribePageHidden = null

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

/** Keep the screen awake until the returned idempotent function is called. */
export function keepScreenAwake() {
    const owner = Symbol('screen wake lock owner')
    owners.add(owner)
    // The shared lifecycle service handles hiding and returning, including bfcache and focus.
    if (owners.size === 1) {
        unsubscribePageHidden = subscribePageHidden(releaseSentinel)
        unsubscribePageVisible = subscribePageVisible(requestIfNeeded)
    }
    requestIfNeeded()

    return () => {
        if (!owners.delete(owner)) return
        if (owners.size) return
        unsubscribePageVisible?.()
        unsubscribePageVisible = null
        unsubscribePageHidden?.()
        unsubscribePageHidden = null
        releaseSentinel()
    }
}
