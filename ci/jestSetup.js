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
