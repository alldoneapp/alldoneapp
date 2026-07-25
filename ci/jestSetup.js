// Native Expo modules are not available in GitLab's Node/JSDOM runner.
// Keep the public values used by TranslationService and language-specific tests.
jest.mock('expo-localization', () => ({
    locale: 'en-US',
    locales: ['en-US'],
    timezone: 'UTC',
    getLocales: () => [
        {
            languageCode: 'en',
            languageTag: 'en-US',
            regionCode: 'US',
            textDirection: 'ltr',
        },
    ],
    getCalendars: () => [],
}))

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
