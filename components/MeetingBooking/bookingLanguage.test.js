import * as Localization from 'expo-localization'

import {
    BOOKING_LANGUAGE_STORAGE_KEY,
    getInitialBookingLanguage,
    normalizeBookingLanguage,
    persistBookingLanguage,
} from './bookingLanguage'

jest.mock('expo-localization', () => ({
    locale: 'en-US',
}))

describe('bookingLanguage', () => {
    beforeEach(() => {
        Localization.locale = 'en-US'
    })

    test('normalizes supported regional languages and rejects unsupported languages', () => {
        expect(normalizeBookingLanguage('de-DE')).toBe('de')
        expect(normalizeBookingLanguage('ES_es')).toBe('es')
        expect(normalizeBookingLanguage('fr-FR')).toBeNull()
    })

    test('falls back safely when browser storage is unavailable', () => {
        Localization.locale = 'de-DE'
        const unavailableStorage = {
            getItem: jest.fn(() => {
                throw new Error('Blocked')
            }),
            setItem: jest.fn(() => {
                throw new Error('Blocked')
            }),
        }

        expect(getInitialBookingLanguage(unavailableStorage)).toBe('de')
        expect(persistBookingLanguage('es', unavailableStorage)).toBe(false)
    })

    test('ignores an invalid persisted value', () => {
        Localization.locale = 'es-MX'
        const storage = { getItem: jest.fn(() => 'fr') }

        expect(getInitialBookingLanguage(storage)).toBe('es')
        expect(storage.getItem).toHaveBeenCalledWith(BOOKING_LANGUAGE_STORAGE_KEY)
    })
})
