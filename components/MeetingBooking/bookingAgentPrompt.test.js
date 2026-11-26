import { setLanguage } from '../../i18n/TranslationService'
import { buildBookingAgentPrompt, copyBookingText, getBookingPageUrl } from './bookingAgentPrompt'

describe('bookingAgentPrompt (AT-3161)', () => {
    afterEach(() => {
        setLanguage('en')
        delete navigator.clipboard
        delete document.execCommand
    })

    test('builds the page URL from the origin it runs on', () => {
        expect(getBookingPageUrl('karsten-wysk', 'https://my.alldone.app')).toBe(
            'https://my.alldone.app/meet/karsten-wysk'
        )
        expect(getBookingPageUrl('anna-team', 'https://mystaging.alldone.app/')).toBe(
            'https://mystaging.alldone.app/meet/anna-team'
        )
        expect(getBookingPageUrl('demo', 'https://localhost:19006')).toBe('https://localhost:19006/meet/demo')
    })

    test("defaults to the app's link origin, which in a browser is the page's own", () => {
        expect(getBookingPageUrl('demo')).toBe(`${window.location.origin}/meet/demo`)
    })

    test('the prompt is short, carries the URL once, prefers known context and requires confirmation', () => {
        const url = 'https://mystaging.alldone.app/meet/anna-team'
        const expected = {
            en: [
                'Use existing context (name, email, time zone, preferences)',
                'my calendar, if connected',
                'Ask only for missing details',
                'Book only after I confirm',
            ],
            de: [
                'Nutze vorhandenen Kontext (Name, E-Mail, Zeitzone, Präferenzen)',
                'falls verbunden, meinen Kalender',
                'Frage nur nach fehlenden Angaben',
                'Buche erst nach meiner Bestätigung',
            ],
            es: [
                'Usa el contexto disponible (nombre, correo, zona horaria, preferencias)',
                'mi calendario, si está conectado',
                'Pregunta solo por lo que falte',
                'Reserva solo tras mi confirmación',
            ],
        }
        Object.entries(expected).forEach(([language, phrases]) => {
            setLanguage(language)
            const prompt = buildBookingAgentPrompt(url)
            expect(prompt.split(url)).toHaveLength(2)
            // The URL ends its line, so no sentence punctuation sticks to the link.
            expect(prompt).toContain(`${url}\n`)
            phrases.forEach(phrase => expect(prompt).toContain(phrase))
            expect(prompt).not.toContain('%{')
            expect(prompt.length - url.length).toBeLessThan(220)
        })
    })

    test('reports whether the copy worked', async () => {
        const writeText = jest.fn(() => Promise.resolve())
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        await expect(copyBookingText('hello')).resolves.toBe(true)
        expect(writeText).toHaveBeenCalledWith('hello')

        writeText.mockImplementation(() => Promise.reject(new Error('denied')))
        document.execCommand = jest.fn(() => false)
        await expect(copyBookingText('hello')).resolves.toBe(false)

        document.execCommand = jest.fn(() => {
            throw new Error('unsupported')
        })
        await expect(copyBookingText('hello')).resolves.toBe(false)
        expect(document.querySelectorAll('textarea')).toHaveLength(0)

        document.execCommand = jest.fn(() => true)
        await expect(copyBookingText('hello')).resolves.toBe(true)
    })
})
