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
        expect(instructions).toContain('Never introduce yourself as ChatGPT')
        expect(instructions.indexOf('Be precise and act immediately.')).toBeLessThan(
            instructions.indexOf('Always identify yourself as Anna Alldone.')
        )
    })

    test('names the configured assistant explicitly in the greeting request', () => {
        expect(buildCallGreetingInstruction(assistant)).toBe(
            'Greet the caller briefly, introduce yourself only as Anna Alldone, and ask how you can help. Do not mention ChatGPT or OpenAI.'
        )
    })
})
