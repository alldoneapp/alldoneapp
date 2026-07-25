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
