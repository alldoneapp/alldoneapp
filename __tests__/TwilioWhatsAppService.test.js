// Ensure functions helpers treat the environment like the emulator during tests
process.env.FUNCTIONS_EMULATOR = 'true'

const TwilioWhatsAppService = require('../functions/Services/TwilioWhatsAppService')

describe('TwilioWhatsAppService WhatsApp content preparation', () => {
    let service

    beforeEach(() => {
        service = new TwilioWhatsAppService()
    })

    it('uses fallback text when task result is empty', () => {
        const result = service._prepareTaskResultForTemplate('   ')

        expect(result.value).toBe('Task completed successfully')
        expect(result.isValid).toBe(true)
        expect(result.blockingIssues).toHaveLength(0)
        expect(result.adjustments).toEqual(
            expect.arrayContaining(['Replaced empty task result with default fallback message.'])
        )
    })

    it('normalises excessive whitespace and line breaks', () => {
        const messyContent = 'Line one\n\n\n    Line two      with    spaces\n  Third line'
        const result = service._prepareTaskResultForTemplate(messyContent)

        expect(result.isValid).toBe(true)
        expect(result.blockingIssues).toHaveLength(0)
        expect(result.value).toBe('Line one\nLine two    with    spaces\nThird line')
        expect(result.adjustments).toEqual(
            expect.arrayContaining([
                'Collapsed blank lines (including whitespace-only lines) to a single newline.',
                'Removed leading whitespace from lines to prevent leading spaces after newlines.',
            ])
        )
    })

    it('flags unsafe content when emoji usage exceeds limits', () => {
        const elevenPartyPopper = '🎉'.repeat(11)
        const result = service._prepareTaskResultForTemplate(elevenPartyPopper)

        expect(result.isValid).toBe(false)
        expect(result.blockingIssues).toEqual(
            expect.arrayContaining([
                'WhatsApp content contains more than 10 emoji characters, exceeding safe limits (found 11).',
            ])
        )
    })
})
