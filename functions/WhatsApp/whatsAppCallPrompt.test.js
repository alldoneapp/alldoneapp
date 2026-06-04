const {
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallIdentityInstruction,
} = require('./whatsAppCallPrompt')

describe('WhatsApp call prompt', () => {
    const assistant = {
        displayName: 'Anna Alldone',
        instructions: 'Be precise and act immediately.',
    }

    test('makes the configured assistant identity available before sideband context loads', () => {
        const instructions = buildCallBootstrapInstructions(assistant)

        expect(instructions).toContain(buildCallIdentityInstruction(assistant))
        expect(instructions).toContain('Be precise and act immediately.')
        expect(instructions).toContain('Use short, natural spoken responses.')
        expect(instructions).toContain('Never say you are ChatGPT')
        expect(instructions).toContain('Do not repeat your name or re-introduce yourself on every turn')
        expect(instructions.indexOf('Be precise and act immediately.')).toBeLessThan(
            instructions.indexOf('say only that you are Anna Alldone')
        )
    })

    test('names the configured assistant explicitly in the greeting request', () => {
        expect(buildCallGreetingInstruction(assistant)).toBe(
            'Greet the caller briefly, introduce yourself only as Anna Alldone, and ask how you can help. Do not mention ChatGPT or OpenAI.'
        )
    })
})
