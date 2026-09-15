/** @jest-environment jsdom */

import { installAppResumeListener } from './appResume'

const createEventTarget = (extra = {}) => {
    const listeners = {}
    return {
        ...extra,
        addEventListener: (type, fn) => {
            listeners[type] = listeners[type] || []
            listeners[type].push(fn)
        },
        removeEventListener: (type, fn) => {
            listeners[type] = (listeners[type] || []).filter(listener => listener !== fn)
        },
        emit: type => (listeners[type] || []).forEach(fn => fn()),
        listenerCount: type => (listeners[type] || []).length,
    }
}

const setup = ({ startAt = 100000 } = {}) => {
    let clock = startAt
    const windowObject = createEventTarget()
    const documentObject = createEventTarget({ visibilityState: 'visible' })
    const resumes = []
    const calls = { connection: [], integrity: 0, serviceWorker: 0 }

    const stop = installAppResumeListener({
        windowObject,
        documentObject,
        navigatorObject: {},
        now: () => clock,
        onResume: event => resumes.push(event),
        evaluateConnection: hiddenMs => calls.connection.push(hiddenMs),
        runIntegrityCheck: () => calls.integrity++,
        updateServiceWorker: () => calls.serviceWorker++,
    })

    return {
        windowObject,
        documentObject,
        resumes,
        calls,
        stop,
        advance: ms => {
            clock += ms
        },
        hide: () => {
            documentObject.visibilityState = 'hidden'
            documentObject.emit('visibilitychange')
        },
        show: () => {
            documentObject.visibilityState = 'visible'
            documentObject.emit('visibilitychange')
        },
    }
}

describe('installAppResumeListener', () => {
    it('does nothing and returns a noop without a window', () => {
        const stop = installAppResumeListener({ windowObject: undefined })
        expect(typeof stop).toBe('function')
        stop()
    })

    it('reports ONE resume when the ordinary browser signals fire for the same return', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)

        // A bfcache restore genuinely emits these together.
        harness.show()
        harness.windowObject.emit('pageshow')
        harness.windowObject.emit('focus')

        expect(harness.resumes).toHaveLength(1)
        expect(harness.calls.connection).toHaveLength(1)
        harness.stop()
    })

    it('keeps the real absence when focus arrives before visibility becomes visible', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)

        // Android Chrome/TWA can wake and focus its surface before updating the
        // document visibility state. This early signal must not reset the clock.
        harness.windowObject.emit('focus')
        harness.show()

        expect(harness.resumes).toEqual([{ hiddenMs: 10 * 60 * 1000 }])
        expect(harness.calls.connection).toEqual([10 * 60 * 1000])
        harness.stop()
    })

    it('recognises Chrome Page Lifecycle resume after a frozen Android page thaws', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)

        harness.documentObject.visibilityState = 'visible'
        harness.documentObject.emit('resume')

        expect(harness.resumes).toEqual([{ hiddenMs: 10 * 60 * 1000 }])
        expect(harness.calls.connection).toHaveLength(1)
        harness.stop()
    })

    it('ignores focus on a tab that stayed visible', () => {
        const harness = setup()
        harness.advance(10 * 60 * 1000)

        harness.windowObject.emit('focus')

        expect(harness.resumes).toHaveLength(0)
        expect(harness.calls.connection).toHaveLength(0)
        harness.stop()
    })

    it('uses freeze and resume when visibilitychange is unavailable', () => {
        const harness = setup()
        harness.documentObject.emit('freeze')
        harness.advance(10 * 60 * 1000)

        harness.documentObject.emit('resume')

        expect(harness.resumes).toEqual([{ hiddenMs: 10 * 60 * 1000 }])
        expect(harness.calls.connection).toHaveLength(1)
        harness.stop()
    })

    it('uses pagehide and pageshow for a bfcache restore that remains visible', () => {
        const harness = setup()
        harness.windowObject.emit('pagehide')
        harness.advance(10 * 60 * 1000)

        harness.windowObject.emit('pageshow')

        expect(harness.resumes).toEqual([{ hiddenMs: 10 * 60 * 1000 }])
        expect(harness.calls.connection).toHaveLength(1)
        harness.stop()
    })

    it('treats two genuinely separate returns as two resumes', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)
        harness.show()

        harness.hide()
        harness.advance(10 * 60 * 1000)
        harness.show()

        expect(harness.resumes).toHaveLength(2)
        harness.stop()
    })

    it('consumes a rapid second absence instead of reusing it on a later focus', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)
        harness.show()

        harness.advance(500)
        harness.hide()
        harness.advance(100)
        harness.show()
        harness.advance(10 * 60 * 1000)
        harness.windowObject.emit('focus')

        expect(harness.resumes).toEqual([{ hiddenMs: 10 * 60 * 1000 }])
        expect(harness.calls.connection).toHaveLength(1)
        harness.stop()
    })

    it('does nothing at all for a short absence', () => {
        const harness = setup()
        harness.hide()
        harness.advance(5000)
        harness.show()

        expect(harness.resumes).toHaveLength(0)
        expect(harness.calls.connection).toHaveLength(0)
        expect(harness.calls.integrity).toBe(0)
        expect(harness.calls.serviceWorker).toBe(0)
        harness.stop()
    })

    it('probes the connection but skips the integrity check for a medium absence', () => {
        const harness = setup()
        harness.hide()
        harness.advance(2 * 60 * 1000)
        harness.show()

        expect(harness.calls.connection).toEqual([2 * 60 * 1000])
        expect(harness.calls.integrity).toBe(0)
        expect(harness.calls.serviceWorker).toBe(0)
        harness.stop()
    })

    it('also re-runs the integrity check after a long absence', () => {
        const harness = setup()
        harness.hide()
        harness.advance(10 * 60 * 1000)
        harness.show()

        expect(harness.calls.connection).toHaveLength(1)
        expect(harness.calls.integrity).toBe(1)
        expect(harness.calls.serviceWorker).toBe(0)
        harness.stop()
    })

    it('also asks the service worker for a new build after a very long absence', () => {
        const harness = setup()
        harness.hide()
        harness.advance(3 * 60 * 60 * 1000)
        harness.show()

        expect(harness.calls.connection).toHaveLength(1)
        expect(harness.calls.integrity).toBe(1)
        expect(harness.calls.serviceWorker).toBe(1)
        harness.stop()
    })

    it('starts the clock when the app goes away, not when it was last used', () => {
        const harness = setup()
        // Time passes while the app is visible and in use — that is not an absence.
        harness.advance(10 * 60 * 1000)
        harness.hide()
        harness.advance(1000)
        harness.show()

        expect(harness.resumes).toHaveLength(0)
        harness.stop()
    })

    it('reports the absence duration to its observers', () => {
        const harness = setup()
        harness.hide()
        harness.advance(7 * 60 * 1000)
        harness.show()

        expect(harness.resumes[0].hiddenMs).toBe(7 * 60 * 1000)
        harness.stop()
    })

    it('removes every listener on uninstall', () => {
        const harness = setup()
        expect(harness.documentObject.listenerCount('visibilitychange')).toBe(1)
        expect(harness.documentObject.listenerCount('freeze')).toBe(1)
        expect(harness.documentObject.listenerCount('resume')).toBe(1)
        expect(harness.windowObject.listenerCount('pagehide')).toBe(1)
        expect(harness.windowObject.listenerCount('pageshow')).toBe(1)
        expect(harness.windowObject.listenerCount('focus')).toBe(1)

        harness.stop()

        expect(harness.documentObject.listenerCount('visibilitychange')).toBe(0)
        expect(harness.documentObject.listenerCount('freeze')).toBe(0)
        expect(harness.documentObject.listenerCount('resume')).toBe(0)
        expect(harness.windowObject.listenerCount('pagehide')).toBe(0)
        expect(harness.windowObject.listenerCount('pageshow')).toBe(0)
        expect(harness.windowObject.listenerCount('focus')).toBe(0)
    })
})
