export const DAILY_APP_LOAD_DATE_STORAGE_KEY = 'alldone.lastFullAppLoadLocalDate'

const MIDNIGHT_GRACE_PERIOD = 1000
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function getLocalCalendarDate(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function getMillisecondsUntilNextLocalDay(date) {
    const nextLocalDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    return Math.max(nextLocalDay.getTime() - date.getTime() + MIDNIGHT_GRACE_PERIOD, MIDNIGHT_GRACE_PERIOD)
}

function getStoredAppLoadDate(storage) {
    if (!storage) return null
    try {
        const storedDate = storage.getItem(DAILY_APP_LOAD_DATE_STORAGE_KEY)
        return LOCAL_DATE_PATTERN.test(storedDate) ? storedDate : null
    } catch (error) {
        return null
    }
}

function storeAppLoadDate(storage, date) {
    if (!storage) return

    try {
        const storedDate = getStoredAppLoadDate(storage)
        // Do not move the marker backwards if the device clock or timezone was
        // corrected. The in-memory loaded date still protects the current page.
        if (!storedDate || storedDate < date) storage.setItem(DAILY_APP_LOAD_DATE_STORAGE_KEY, date)
    } catch (error) {
        // Storage can be unavailable in private/restricted browser contexts.
        // The page-local guard below still safely reloads once.
    }
}

/**
 * Reloads a browser page once when a page that was loaded on an earlier local
 * calendar day becomes active.
 *
 * On first use it records the current date as a baseline. On later days an
 * older marker triggers a reload even if the browser was fully closed
 * overnight. A page kept alive across midnight reloads from the midnight
 * timer, or from focus/visibility/pageshow when the browser resumes it later.
 * The persisted marker is browser/device-local and deliberately has no user
 * ID; account-scoped new-day acknowledgement remains independent in Firestore.
 */
export function startDailyAppReload({
    windowObject = typeof window === 'undefined' ? undefined : window,
    documentObject = typeof document === 'undefined' ? undefined : document,
    storage,
    now = () => new Date(),
    reload,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
} = {}) {
    if (!windowObject || !documentObject) return () => {}

    let localStorage = storage
    if (localStorage === undefined) {
        try {
            localStorage = windowObject.localStorage
        } catch (error) {
            localStorage = null
        }
    }

    const loadedDate = getLocalCalendarDate(now())
    const reloadPage = reload || (() => windowObject.location.reload())
    let reloadStarted = false
    let timerId

    const previousAppLoadDate = getStoredAppLoadDate(localStorage)
    const needsStartupReload = previousAppLoadDate && previousAppLoadDate < loadedDate

    // No marker means this is the first observed load on this browser/device,
    // so use it as the baseline rather than immediately loading it twice.
    if (!needsStartupReload) storeAppLoadDate(localStorage, loadedDate)

    const reloadIfNewLocalDay = () => {
        if (reloadStarted || documentObject.visibilityState === 'hidden') return

        const currentDate = getLocalCalendarDate(now())
        if (!needsStartupReload && currentDate <= loadedDate) return

        // Mark before navigating and latch in memory. Both are intentional:
        // navigation can be delayed, while storage can be unavailable.
        reloadStarted = true
        storeAppLoadDate(localStorage, currentDate)
        reloadPage()
    }

    const scheduleMidnightCheck = () => {
        const currentTime = now()
        timerId = setTimer(() => {
            reloadIfNewLocalDay()
            if (!reloadStarted) scheduleMidnightCheck()
        }, getMillisecondsUntilNextLocalDay(currentTime))
    }

    const handleVisibilityChange = () => {
        if (documentObject.visibilityState !== 'hidden') reloadIfNewLocalDay()
    }

    // Mark before navigating. The replacement document reads today's marker,
    // which is the persisted half of the reload-loop guard. A browser-restored
    // background tab waits until it actually becomes visible.
    if (needsStartupReload && documentObject.visibilityState !== 'hidden') {
        reloadIfNewLocalDay()
        return () => {}
    }

    documentObject.addEventListener('visibilitychange', handleVisibilityChange)
    windowObject.addEventListener('focus', reloadIfNewLocalDay)
    windowObject.addEventListener('pageshow', reloadIfNewLocalDay)
    scheduleMidnightCheck()

    return () => {
        if (timerId !== undefined) clearTimer(timerId)
        documentObject.removeEventListener('visibilitychange', handleVisibilityChange)
        windowObject.removeEventListener('focus', reloadIfNewLocalDay)
        windowObject.removeEventListener('pageshow', reloadIfNewLocalDay)
    }
}
