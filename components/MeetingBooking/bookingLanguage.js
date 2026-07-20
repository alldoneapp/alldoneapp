import { getDeviceLanguage } from '../../i18n/TranslationService'

export const BOOKING_LANGUAGE_STORAGE_KEY = 'alldone_booking_language'
export const BOOKING_LANGUAGES = ['en', 'de', 'es']

export const normalizeBookingLanguage = language => {
    const normalizedLanguage = String(language || '')
        .toLowerCase()
        .split(/[-_]/)[0]

    return BOOKING_LANGUAGES.includes(normalizedLanguage) ? normalizedLanguage : null
}

const getBrowserStorage = () => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null
    } catch (error) {
        return null
    }
}

export const getInitialBookingLanguage = (storage = getBrowserStorage()) => {
    try {
        const persistedLanguage = normalizeBookingLanguage(storage?.getItem(BOOKING_LANGUAGE_STORAGE_KEY))
        if (persistedLanguage) return persistedLanguage
    } catch (error) {
        // Storage can be disabled by browser privacy settings. Browser language is
        // still a safe, deterministic fallback in that case.
    }

    return normalizeBookingLanguage(getDeviceLanguage()) || 'en'
}

export const persistBookingLanguage = (language, storage = getBrowserStorage()) => {
    const normalizedLanguage = normalizeBookingLanguage(language)
    if (!normalizedLanguage) return false

    try {
        storage?.setItem(BOOKING_LANGUAGE_STORAGE_KEY, normalizedLanguage)
        return Boolean(storage)
    } catch (error) {
        return false
    }
}
