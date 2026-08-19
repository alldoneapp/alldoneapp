import UserDataCache from './UserDataCache'

const CACHE_KEYS = {
    USER_DATA: 'alldone_cached_user_data',
    CACHE_TIMESTAMP: 'alldone_cache_timestamp',
    CACHE_VERSION: 'alldone_cache_version',
}

const seedCache = ({ ageMs }) => {
    localStorage.setItem(CACHE_KEYS.USER_DATA, JSON.stringify({ uid: 'user1' }))
    localStorage.setItem(CACHE_KEYS.CACHE_TIMESTAMP, String(Date.now() - ageMs))
    localStorage.setItem(CACHE_KEYS.CACHE_VERSION, '1.0')
}

const setNavigatorOnLine = value => {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

describe('UserDataCache offline expiry tolerance (OFFLINE_SUPPORT_PLAN.md Stage 5)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    afterEach(() => {
        localStorage.clear()
        setNavigatorOnLine(true)
    })

    it('serves a fresh cache normally', () => {
        seedCache({ ageMs: 1000 })
        expect(UserDataCache.getCachedUserData()).toEqual({ uid: 'user1' })
    })

    it('rejects an expired cache while online', () => {
        seedCache({ ageMs: 2 * DAY_MS })
        expect(UserDataCache.getCachedUserData()).toBeNull()
    })

    it('serves an expired cache while offline — stale beats blank', () => {
        seedCache({ ageMs: 2 * DAY_MS })
        setNavigatorOnLine(false)
        expect(UserDataCache.getCachedUserData()).toEqual({ uid: 'user1' })
    })

    it('never serves a version-mismatched cache, even offline', () => {
        seedCache({ ageMs: 1000 })
        localStorage.setItem(CACHE_KEYS.CACHE_VERSION, '0.9')
        setNavigatorOnLine(false)
        expect(UserDataCache.getCachedUserData()).toBeNull()
    })
})
