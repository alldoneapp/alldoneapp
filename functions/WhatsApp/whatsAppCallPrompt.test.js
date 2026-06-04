const {
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallHistoryContextMessage,
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
            instructions.indexOf('say only that you are Anna')
        )
    })

    test('introduces the assistant by first name only, never the full display name', () => {
        const identity = buildCallIdentityInstruction(assistant)
        expect(identity).toContain('You are Anna,')
        expect(identity).toContain('say only that you are Anna — use this first name only')
        expect(identity).not.toContain('Anna Alldone')
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
        const greeting = buildCallGreetingInstruction(assistant, 'German')
        expect(greeting).toContain('Greet the caller briefly in German')
        expect(greeting).toContain('introduce yourself only as Anna,')
        expect(greeting).not.toContain('Anna Alldone')
        expect(greeting).toContain('ask how you can help')
        expect(greeting).toContain('Do not mention ChatGPT or OpenAI.')
    })

    test('defaults the greeting language to English when no settings language is available', () => {
        expect(buildCallGreetingInstruction(assistant)).toContain('Greet the caller briefly in English')
    })

    test('greeting forces a clean opener that does not resume earlier conversation', () => {
        const greeting = buildCallGreetingInstruction(assistant, 'English')
        expect(greeting).toContain('This is the very start of a new incoming phone call')
        expect(greeting).toContain('background context only')
        expect(greeting).toContain('do not assume there is a pending task')
        expect(greeting).toContain('wait for the caller')
    })

    test('voice instructions treat earlier conversation as background context only', () => {
        const instructions = buildCallBootstrapInstructions(assistant)
        expect(instructions).toContain('provided to you only as background context')
        expect(instructions).toContain('never assume there is a pending task or output to work on')
    })

    describe('call history context block', () => {
        test('returns empty string when there is no history', () => {
            expect(buildCallHistoryContextMessage([])).toBe('')
            expect(buildCallHistoryContextMessage(undefined)).toBe('')
        })

        test('renders prior turns as a labeled, read-only background block (not live turns)', () => {
            const block = buildCallHistoryContextMessage([
                ['user', 'Add a task for the report'],
                ['assistant', 'Done, I created it.'],
            ])
            expect(block).toContain('Background context — here is what was discussed')
            expect(block).toContain('for your reference only')
            expect(block).toContain('do not read it aloud')
            expect(block).toContain('User: Add a task for the report')
            expect(block).toContain('You: Done, I created it.')
        })

        test('extracts text from multimodal content and skips empty turns', () => {
            const block = buildCallHistoryContextMessage([
                [
                    'user',
                    [
                        { type: 'text', text: 'See this image' },
                        { type: 'image_url', image_url: { url: 'x' } },
                    ],
                ],
                ['assistant', '   '],
            ])
            expect(block).toContain('User: See this image')
            expect(block).not.toContain('You:')
        })

        test('caps the block to the most recent turns', () => {
            const history = Array.from({ length: 30 }, (_, i) => ['user', `msg ${i}`])
            const block = buildCallHistoryContextMessage(history, { maxTurns: 5 })
            expect(block).toContain('msg 29')
            expect(block).toContain('msg 25')
            expect(block).not.toContain('msg 24')
        })
    })
})
