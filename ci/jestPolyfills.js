// Runs as a setupFile (before the test framework and every module import).
//
// jest 27+'s jsdom environment stopped injecting setImmediate/clearImmediate
// (browsers never had them), but react-native-web and RN-era app code still
// call them at import time. Node's real timers implementation is available in
// the jest sandbox, so hand those through instead of a setTimeout imitation.
//
// Real timers have one property jsdom's own timers do not: tearing the file's
// environment down does not cancel them. React's scheduler picks setImmediate
// over every other channel, so work it queued near the end of a test (passive
// effects, a continuation of its work loop) could still run after jsdom had
// gone — on a fast machine it never does, on a busy CI runner occasionally. An
// effect then threw without `window`, React tried to report it through a fake
// DOM event, found no `document`, and the throw crashed the whole --runInBand
// process with "The `document` global was defined when React was initialized,
// but is not defined anymore", in whichever unrelated file happened to run
// next. That failed master pipelines seven times between August and September
// 2026. So an immediate that fires after its own environment is gone is
// dropped, exactly as jsdom drops its setTimeout callbacks at teardown.
const timers = require('timers')

const environmentIsAlive = () => typeof document !== 'undefined' && document !== null

const guardImmediate =
    (setImmediate, isAlive) =>
    (callback, ...args) =>
        setImmediate(() => {
            if (isAlive()) callback(...args)
        })

module.exports = { guardImmediate }

if (typeof globalThis.setImmediate === 'undefined') {
    globalThis.setImmediate = guardImmediate(timers.setImmediate, environmentIsAlive)
    globalThis.clearImmediate = timers.clearImmediate
}
