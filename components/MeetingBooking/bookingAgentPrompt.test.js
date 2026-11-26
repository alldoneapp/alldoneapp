import { setLanguage } from '../../i18n/TranslationService'
import { buildBookingAgentPrompt, copyBookingText, getBookingMcpUrl, getBookingPageUrl } from './bookingAgentPrompt'

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

    test("builds the page's public MCP URL from the same origin and slug", () => {
        expect(getBookingMcpUrl('karsten-wysk', 'https://my.alldone.app/')).toBe(
            'https://my.alldone.app/api/booking/mcp/karsten-wysk'
        )
        expect(getBookingMcpUrl('demo')).toBe(`${window.location.origin}/api/booking/mcp/demo`)
    })

    test('the prompt names the tools, rules out the browser, asks before booking and stays short', () => {
        const origin = 'https://mystaging.alldone.app'
        const url = `${origin}/meet/anna-team`
        const mcpUrl = `${origin}/api/booking/mcp/anna-team`
        const tools = ['get_public_booking_page', 'find_public_booking_times', 'book_public_meeting']
        const expected = {
            en: [
                'not the browser',
                'Use my context',
                'if connected, my calendar',
                'Propose one slot with date, time and time zone',
                'book only after I confirm that slot',
                'tell me to connect Alldone or refresh its tools',
            ],
            de: [
                'nicht den Browser',
                'Nutze meinen Kontext',
                'falls verbunden, meinen Kalender',
                'Schlag einen Termin mit Datum, Uhrzeit und Zeitzone vor',
                'buche erst, wenn ich genau diesen bestätige',
                'dass ich Alldone verbinden oder die Tools aktualisieren soll',
            ],
            es: [
                'no el navegador',
                'Usa mi contexto',
                'si está conectado, mi calendario',
                'Propón una cita con fecha, hora y zona horaria',
                'resérvala solo cuando confirme esa cita',
                'dime que conecte Alldone o actualice sus herramientas',
            ],
        }
        Object.entries(expected).forEach(([language, phrases]) => {
            setLanguage(language)
            const prompt = buildBookingAgentPrompt('anna-team', origin)
            expect(prompt.split(url)).toHaveLength(2)
            expect(prompt.split(mcpUrl)).toHaveLength(2)
            // Each URL ends its line (the MCP URL ends the prompt), so no punctuation sticks to a link.
            expect(prompt).toContain(`${url}\n`)
            expect(prompt.endsWith(mcpUrl)).toBe(true)
            tools.forEach(tool => expect(prompt).toContain(tool))
            phrases.forEach(phrase => expect(prompt).toContain(phrase))
            expect(prompt).not.toContain('%{')
            // Short enough to paste: about four sentences besides the two links.
            expect(prompt.length - url.length - mcpUrl.length).toBeLessThan(450)
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
