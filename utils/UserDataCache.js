/**
 * User Data Cache utility for faster app initialization
 * Caches user data in localStorage to reduce Firebase requests on subsequent visits
 */

const CACHE_KEYS = {
    USER_DATA: 'alldone_cached_user_data',
    GLOBAL_DATA: 'alldone_cached_global_data',
    CACHE_TIMESTAMP: 'alldone_cache_timestamp',
    CACHE_VERSION: 'alldone_cache_version',
}

const CACHE_EXPIRY_HOURS = 24 // Cache expires after 24 hours
const CACHE_VERSION = '1.0' // Increment to invalidate all caches

class UserDataCache {
    /**
     * Check if cached data is still valid
     */
    static isCacheValid() {
        try {
            const timestamp = localStorage.getItem(CACHE_KEYS.CACHE_TIMESTAMP)
            const version = localStorage.getItem(CACHE_KEYS.CACHE_VERSION)

            if (!timestamp || !version || version !== CACHE_VERSION) {
                return false
            }

            const cacheAge = Date.now() - parseInt(timestamp)
            const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000

            return cacheAge < maxAge
        } catch (error) {
            console.warn('Error checking cache validity:', error)
            return false
        }
    }

    /**
     * Get cached user data
     */
    static getCachedUserData() {
        try {
            if (!this.isCacheValid()) {
                return null
            }

            const userData = localStorage.getItem(CACHE_KEYS.USER_DATA)
            return userData ? JSON.parse(userData) : null
        } catch (error) {
            console.warn('Error getting cached user data:', error)
            return null
        }
    }

    /**
     * Cache user data
     */
    static setCachedUserData(userData) {
        try {
            localStorage.setItem(CACHE_KEYS.USER_DATA, JSON.stringify(userData))
            localStorage.setItem(CACHE_KEYS.CACHE_TIMESTAMP, Date.now().toString())
            localStorage.setItem(CACHE_KEYS.CACHE_VERSION, CACHE_VERSION)
            console.log('User data cached successfully')
        } catch (error) {
            console.warn('Error caching user data:', error)
        }
    }

    /**
     * Get cached global data (assistants, admin user, etc.)
     */
    static getCachedGlobalData() {
        try {
            if (!this.isCacheValid()) {
                return null
            }

            const globalData = localStorage.getItem(CACHE_KEYS.GLOBAL_DATA)
            return globalData ? JSON.parse(globalData) : null
        } catch (error) {
            console.warn('Error getting cached global data:', error)
            return null
        }
    }

    /**
     * Cache global data
     */
    static setCachedGlobalData(globalData) {
        try {
            localStorage.setItem(CACHE_KEYS.GLOBAL_DATA, JSON.stringify(globalData))
            localStorage.setItem(CACHE_KEYS.CACHE_TIMESTAMP, Date.now().toString())
            localStorage.setItem(CACHE_KEYS.CACHE_VERSION, CACHE_VERSION)
            console.log('Global data cached successfully')
        } catch (error) {
            console.warn('Error caching global data:', error)
        }
    }

    /**
     * Clear all cached data
     */
    static clearCache() {
        try {
            Object.values(CACHE_KEYS).forEach(key => {
                localStorage.removeItem(key)
            })
            console.log('Cache cleared successfully')
        } catch (error) {
            console.warn('Error clearing cache:', error)
        }
    }

    /**
     * Get cache info for debugging
     */
    static getCacheInfo() {
        try {
            const timestamp = localStorage.getItem(CACHE_KEYS.CACHE_TIMESTAMP)
            const version = localStorage.getItem(CACHE_KEYS.CACHE_VERSION)
            const hasUserData = !!localStorage.getItem(CACHE_KEYS.USER_DATA)
            const hasGlobalData = !!localStorage.getItem(CACHE_KEYS.GLOBAL_DATA)

            return {
                isValid: this.isCacheValid(),
                timestamp: timestamp ? new Date(parseInt(timestamp)) : null,
                version,
                hasUserData,
                hasGlobalData,
                ageHours: timestamp ? Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60 * 60)) : null,
            }
        } catch (error) {
            console.warn('Error getting cache info:', error)
            return null
        }
    }
}

export default UserDataCache
