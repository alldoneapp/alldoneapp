import moment from 'moment'
import { setLanguage } from './TranslationService'
import { localizedMoment } from './localizedMoment'

const now = Date.UTC(2026, 9, 5, 10, 40, 53)
beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
})
afterEach(() => {
    jest.useRealTimers()
    setLanguage('en')
})

it.each([
    ['en', '2 minutes ago'],
    ['de', 'vor 2 Minuten'],
    ['es', 'hace 2 minutos'],
    ['de-DE', 'vor 2 Minuten'],
    ['es-ES', 'hace 2 minutos'],
    ['fr', '2 minutes ago'],
])('uses the app locale for Moment relative metadata in %s', (language, expected) => {
    setLanguage(language)
    expect(localizedMoment(now - 120000).fromNow()).toBe(expected)
})

it('leaves global Moment formatting and legacy English-output parsers unchanged', () => {
    const originalLocale = moment.locale()
    setLanguage('de')
    expect(localizedMoment(now).locale()).toBe('de')
    expect(moment.locale()).toBe(originalLocale)
    expect(
        moment(now + 7200000)
            .locale('en')
            .fromNow()
            .split('in')[1]
            .trim()
    ).toBe('2 hours')
})
