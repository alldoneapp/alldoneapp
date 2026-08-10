// The device language must be stable in the JSDOM runner regardless of the
// host machine's navigator.language. Mock the web shim (which replaced
// expo-localization in migration Stage 1) with the values TranslationService
// and language-specific tests rely on.
jest.mock('../utils/WebShims/Localization', () => ({
    locale: 'en-US',
}))

// yjs 13.6 pulls lib0/webcrypto, which reads the global `crypto` at import time.
// Node 14 has no global webcrypto (and this jsdom has no getRandomValues), so
// provide the minimal surface lib0 binds: getRandomValues + a subtle stub.
if (typeof global.crypto === 'undefined') {
    const nodeCrypto = require('crypto')
    global.crypto = {
        subtle: {},
        getRandomValues: buffer => nodeCrypto.randomFillSync(buffer),
    }
}

// The react-tiny-popover build in replacement_node_modules - which CI copies
// over node_modules before running, per the note in CLAUDE.md - constructs a
// ResizeObserver in its constructor. jsdom implements no such API, so any suite
// rendering a component behind a popover dies before it renders anything.
if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
}

// jsdom has no CacheStorage either, and utils/Observers.js references the bare
// `caches` global when clearing the app cache before a refresh - a plain
// ReferenceError here, a real API in every supported browser.
if (typeof global.caches === 'undefined') {
    global.caches = {
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        open: () => Promise.resolve({ keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) }),
        match: () => Promise.resolve(undefined),
    }
}

// The react-native jest preset used to define __DEV__ for every suite; the
// jsdom runner does not, and app code (utils/backends/EmailLine, firestore
// logging) references it as a bare global. Match the old preset's value.
if (typeof global.__DEV__ === 'undefined') {
    global.__DEV__ = true
}

// jsdom does not put TextEncoder/TextDecoder on the global in this Jest
// version, but Node has had both in `util` since 8. Cloud Functions code
// reaches them through its JOSE dependency while merely being imported.
const { TextEncoder, TextDecoder } = require('util')
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder

// String.prototype.replaceAll landed in Node 15. The test runtime is older than
// either place this code actually runs - Cloud Functions deploy to Node 20 and
// every browser the web app supports has it - so the calls are legitimate and
// only the runner needs bringing up to date.
if (!String.prototype.replaceAll) {
    // eslint-disable-next-line no-extend-native
    String.prototype.replaceAll = function (search, replacement) {
        if (search instanceof RegExp) {
            if (!search.global) {
                throw new TypeError('replaceAll must be called with a global RegExp')
            }
            return this.replace(search, replacement)
        }
        // Go through replace with a global pattern rather than split/join, so a
        // replacer function and $-patterns behave the way the real method does.
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return this.replace(new RegExp(escaped, 'g'), replacement)
    }
}

// The jest `react-native` preset validates styles against the *native* prop
// whitelist, while the app renders through react-native-web. Web-only values
// such as `display: 'inline-flex'` (components/Tags/LinkTag.js) are legal in
// the browser but make StyleSheet.create() throw here, which takes down every
// suite that transitively imports the tag components.
jest.mock('react-native/Libraries/StyleSheet/StyleSheetValidation', () => ({
    validateStyle: () => {},
    validateStyleProp: () => {},
    addValidStylePropTypes: () => {},
}))

// React 18 defers passive effects (useEffect) to the scheduler. Legacy suites
// that render with react-test-renderer and never unmount would have those
// effects fire AFTER jest tears down jsdom, crashing the worker with
// "The `document` global was defined when React was initialized, but is not
// defined anymore" (and taking the whole run down with it). Flushing inside
// act() after every test absorbs the deferred work while the DOM still exists.
afterEach(async () => {
    const { act } = require('react-test-renderer')
    await act(async () => {})
})
