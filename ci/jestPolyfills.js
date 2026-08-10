// Runs as a setupFile (before the test framework and every module import).
//
// jest 27+'s jsdom environment stopped injecting setImmediate/clearImmediate
// (browsers never had them), but react-native-web and RN-era app code still
// call them at import time. Node's real timers implementation is available in
// the jest sandbox, so hand those through instead of a setTimeout imitation.
const timers = require('timers')

if (typeof globalThis.setImmediate === 'undefined') {
    globalThis.setImmediate = timers.setImmediate
    globalThis.clearImmediate = timers.clearImmediate
}
