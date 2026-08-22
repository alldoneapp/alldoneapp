/** @jest-environment jsdom */

import {
    getPerformanceDiagnostics,
    PERFORMANCE_DEBUG_STORAGE_KEY,
    PERFORMANCE_DISABLE_NOTES_PREFETCH_STORAGE_KEY,
    PERFORMANCE_DISABLE_PERSISTENCE_STORAGE_KEY,
} from './performanceDiagnostics'

describe('performance diagnostics', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/')
        localStorage.clear()
    })

    test('keeps every experiment disabled by default', () => {
        expect(getPerformanceDiagnostics()).toEqual({
            debug: false,
            disableFirestorePersistence: false,
            disableNotesPrefetch: false,
        })
    })

    test('reads explicit query switches and enables debug output for an experiment', () => {
        window.history.replaceState({}, '', '/?perfDisablePersistence=1&perfDisableNotesPrefetch=true')

        expect(getPerformanceDiagnostics()).toEqual({
            debug: true,
            disableFirestorePersistence: true,
            disableNotesPrefetch: true,
        })
    })

    test('lets query parameters temporarily override stored switches', () => {
        localStorage.setItem(PERFORMANCE_DEBUG_STORAGE_KEY, '1')
        localStorage.setItem(PERFORMANCE_DISABLE_PERSISTENCE_STORAGE_KEY, '1')
        localStorage.setItem(PERFORMANCE_DISABLE_NOTES_PREFETCH_STORAGE_KEY, '1')
        window.history.replaceState({}, '', '/?perfDebug=0&perfDisablePersistence=0&perfDisableNotesPrefetch=0')

        expect(getPerformanceDiagnostics()).toEqual({
            debug: false,
            disableFirestorePersistence: false,
            disableNotesPrefetch: false,
        })
    })
})
