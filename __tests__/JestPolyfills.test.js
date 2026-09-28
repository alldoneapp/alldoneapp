// ci/jestPolyfills.js hands tests Node's real setImmediate, which — unlike jsdom's own timers — is
// not cancelled when a test file's environment is torn down. React's scheduler runs on it, so work
// queued at the end of a test used to fire after jsdom was gone and crash the whole --runInBand
// run ("The `document` global was defined when React was initialized…"). The guard drops an
// immediate whose environment has gone, the way jsdom drops its timers.
const { guardImmediate } = require('../ci/jestPolyfills')

const flushImmediates = () => new Promise(resolve => require('timers').setImmediate(resolve))

describe('the setImmediate polyfill', () => {
    it('runs callbacks, with their arguments, while the environment is alive', async () => {
        const callback = jest.fn()
        guardImmediate(require('timers').setImmediate, () => true)(callback, 'a', 2)
        await flushImmediates()
        expect(callback).toHaveBeenCalledWith('a', 2)
    })

    it('drops a callback that fires after the environment was torn down', async () => {
        let alive = true
        const callback = jest.fn()
        guardImmediate(require('timers').setImmediate, () => alive)(callback)
        alive = false
        await flushImmediates()
        expect(callback).not.toHaveBeenCalled()
    })

    it('is what the test environment actually uses, and can still be cleared', async () => {
        const callback = jest.fn()
        expect(setImmediate).not.toBe(require('timers').setImmediate)
        clearImmediate(setImmediate(callback))
        await flushImmediates()
        expect(callback).not.toHaveBeenCalled()
    })
})
