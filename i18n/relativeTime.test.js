import { setLanguage, translate } from './TranslationService'
import { formatLastEditDate } from './relativeTime'
import en from './translations/en.json'
import de from './translations/de.json'
import es from './translations/es.json'

const now = Date.UTC(2026, 9, 5, 10, 40, 53)
const format = (seconds, options) => formatLastEditDate(now, now - seconds * 1000, options)

afterEach(() => setLanguage('en'))

describe('localized edit times (AT-2692)', () => {
    it.each([
        [
            'en',
            [
                '0 seconds ago',
                '1 second ago',
                '59 seconds ago',
                '1 minute ago',
                '2 minutes ago',
                '1 hour ago',
                '2 hours ago',
            ],
        ],
        [
            'de',
            [
                'vor 0 Sekunden',
                'vor 1 Sekunde',
                'vor 59 Sekunden',
                'vor 1 Minute',
                'vor 2 Minuten',
                'vor 1 Stunde',
                'vor 2 Stunden',
            ],
        ],
        [
            'es',
            [
                '0 segundos atrás',
                '1 segundo atrás',
                '59 segundos atrás',
                '1 minuto atrás',
                '2 minutos atrás',
                '1 hora atrás',
                '2 horas atrás',
            ],
        ],
    ])('formats full %s phrases with singulars and correct word order', (language, expected) => {
        setLanguage(language)
        expect([0, 1, 59, 60, 120, 3600, 7200].map(seconds => format(seconds))).toEqual(expected)
    })

    it.each([
        ['en', ['10s ago', '2m ago', '2h ago'], ['10 sec ago', '2 min ago', '2 hours ago']],
        ['de', ['vor 10s', 'vor 2m', 'vor 2h'], ['vor 10 Sek.', 'vor 2 Min.', 'vor 2 Stunden']],
        ['es', ['10s atrás', '2m atrás', '2h atrás'], ['10 seg atrás', '2 min atrás', '2 horas atrás']],
    ])('localizes compact and tablet %s times', (language, compact, tablet) => {
        setLanguage(language)
        expect([10, 120, 7200].map(seconds => format(seconds, { compact: true, tablet: true }))).toEqual(compact)
        expect([10, 120, 7200].map(seconds => format(seconds, { tablet: true }))).toEqual(tablet)
    })

    it('preserves the chosen absolute date format after 24 hours', () => {
        setLanguage('de')
        expect(format(86399)).toBe('vor 23 Stunden')
        expect(format(86400, { dateFormat: 'MM/DD/YYYY' })).toBe('10/04/2026')
        expect(format(86400, { dateFormat: 'DD.MM.YYYY', compact: true })).toBe('04.10.2026')
    })

    it.each([
        ['de', 'vor einem Tag', 'vor 2 Tagen'],
        ['es', '1 día atrás', '2 días atrás'],
        ['en', '1 day ago', '2 days ago'],
    ])('keeps revision-history days relative in %s', (language, singular, plural) => {
        setLanguage(language)
        expect(format(86400, { relativeDays: true })).toBe(singular)
        expect(format(172800, { relativeDays: true })).toBe(plural)
    })

    it('does not display negative elapsed times when clocks differ', () => {
        setLanguage('de')
        expect(format(-5)).toBe('vor 0 Sekunden')
    })

    it('uses the app language, including regional locales and the existing English fallback', () => {
        setLanguage('de-DE')
        expect(format(10)).toBe('vor 10 Sekunden')
        setLanguage('es-ES')
        expect(format(10)).toBe('10 segundos atrás')
        setLanguage('fr')
        expect(format(10)).toBe('10 seconds ago')
    })

    it.each([
        ['en', en],
        ['de', de],
        ['es', es],
    ])('defines all time variants in %s', (language, translations) => {
        const keys = [
            '1 second ago',
            '1 minute ago',
            '1 hour ago',
            '1 day ago',
            'Amount seconds ago',
            'Amount minutes ago',
            'Amount hours ago',
            'Amount days ago',
            'Amount sec ago',
            'Amount min ago',
            'Amount s ago',
            'Amount m ago',
            'Amount h ago',
        ]
        keys.forEach(key => expect(translations[key]).toBeTruthy())
    })

    it.each([
        ['de', 'Zuletzt geändert von Karsten vor 10 Sekunden', 'Zuletzt geändert von Karsten • 05.10.2026 12:40'],
        ['es', 'Karsten realizó la última edición 10 segundos atrás', 'Última edición por Karsten • 05.10.2026 12:40'],
    ])('renders grammatical revision metadata in %s', (language, relative, absolute) => {
        setLanguage(language)
        expect(translate('Name was last editor Edition', { name: 'Karsten', lastEdition: format(10) })).toBe(relative)
        expect(
            translate('Name was last editor • Date Time', { name: 'Karsten', date: '05.10.2026', time: '12:40' })
        ).toBe(absolute)
    })
})
