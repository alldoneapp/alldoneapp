const {
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallIdentityInstruction,
    buildCallLanguageInstruction,
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

    test('instructs the model to emit a short preamble before tool calls', () => {
        const instructions = buildCallBootstrapInstructions(assistant)

        expect(instructions).toContain('Immediately before calling a tool, say one short, natural line')
        expect(instructions).toContain('Do not use generic fillers like "please wait while I process."')
    })

    test('omits the language directive from bootstrap instructions when no language is provided', () => {
        expect(buildCallBootstrapInstructions(assistant)).not.toContain('Start the call in')
    })

    test('adds the configured settings language to bootstrap instructions when provided', () => {
        expect(buildCallBootstrapInstructions(assistant, 'German')).toContain('Start the call in German')
    })

    test('starts the call in the settings language but follows the caller afterwards', () => {
        const instruction = buildCallLanguageInstruction('German')
        expect(instruction).toContain('Start the call in German')
        expect(instruction).toContain('follow them and continue the conversation in the language they are speaking')
    })

    test('defaults the language instruction to English when no settings language is available', () => {
        expect(buildCallLanguageInstruction()).toContain('Start the call in English')
    })

    test('greets the caller in the settings language', () => {
        expect(buildCallGreetingInstruction(assistant, 'German')).toBe(
            'Greet the caller briefly in German, introduce yourself only as Anna Alldone, and ask how you can help. Do not mention ChatGPT or OpenAI.'
        )
    })

    test('defaults the greeting language to English when no settings language is available', () => {
        expect(buildCallGreetingInstruction(assistant)).toBe(
            'Greet the caller briefly in English, introduce yourself only as Anna Alldone, and ask how you can help. Do not mention ChatGPT or OpenAI.'
        )
    })
})
