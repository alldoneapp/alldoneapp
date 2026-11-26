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

    test('the prompt carries the URL once and requires confirmation, in every language', () => {
        const url = 'https://mystaging.alldone.app/meet/anna-team'
        const confirmations = {
            en: 'Only book once I have explicitly confirmed',
            de: 'Buche erst, nachdem ich eine davon ausdrücklich bestätigt habe',
            es: 'Reserva solo cuando haya confirmado expresamente',
        }
        Object.entries(confirmations).forEach(([language, confirmation]) => {
            setLanguage(language)
            const prompt = buildBookingAgentPrompt(url)
            expect(prompt.split(url)).toHaveLength(2)
            expect(prompt).toContain(confirmation)
            expect(prompt).not.toContain('%{')
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
