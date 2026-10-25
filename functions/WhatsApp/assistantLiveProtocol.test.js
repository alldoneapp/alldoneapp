const { createLiveTranscript, buildLiveSession } = require('./assistantLiveProtocol')

test('uses client delegation and keeps task instructions in the configured backend', () => {
    const config = buildLiveSession({
        assistant: { displayName: 'Anna Alldone', instructions: 'Private task workflow' },
        voice: 'marin',
        language: 'German',
    })
    expect(config).toMatchObject({ model: 'gpt-live-1', store: false, delegation: { type: 'client' } })
    expect(config.instructions).not.toContain('Private task workflow')
    expect(config.instructions).toContain('German')
})

test('explains voice-only background answers and requires confirmation before claiming chat delivery', () => {
    const { instructions } = buildLiveSession({ assistant: { displayName: 'Anna' } })
    expect(instructions).toContain('not automatically posted as chat messages')
    expect(instructions).toContain('unless the backend confirms that specific content was posted')
    expect(instructions).toContain('Delegate explicit requests for a written/chat answer')
    expect(instructions).not.toContain('say links are in the chat')
})

test.each(['browser_call', 'phone_call', 'whatsapp_call'])(
    'keeps task links visual by default and allows explicit URL speech opt-in on %s',
    channel => {
        const { instructions } = buildLiveSession({ assistant: { displayName: 'Anna' }, channel })
        expect(instructions).toContain(
            'URLs, including newly created task links and similar links, are silent by default'
        )
        expect(instructions).toContain('Read a URL aloud only when the caller explicitly asks to hear that URL')
        expect(instructions).toContain('use the exact verified URL without Markdown formatting')
        expect(instructions).toContain('does not count as asking to hear a URL')
        expect(instructions).toContain('conversation history do not count as explicit opt-in')
        expect(instructions).toContain('a current explicit request to hear a URL overrides older blanket rules')
        expect(instructions).toContain('displayed in the existing chat, not a separate call window')
        expect(instructions).toContain('Newly created notes likewise appear by name and link in the existing chat')
        expect(instructions).toContain('this does not mean a research answer was posted')
        expect(instructions).not.toMatch(/Never read (?:a URL|URLs) aloud|Links are visual only/)
    }
)

test('preserves original whitespace, overlapping speakers and late fragments without duplicate replay', () => {
    const t = createLiveTranscript()
    const input = (id, delta, start, end) => ({
        type: 'session.input_transcript.delta',
        event_id: id,
        delta,
        start_ms: start,
        end_ms: end,
    })
    t.append(input('a', 'Book', 100, 200))
    t.append(input('b', ' Friday.', 400, 500))
    t.append({ ...input('c', 'Sure.', 250, 300), type: 'session.output_transcript.delta' })
    t.append(input('d', ' on', 200, 400))
    t.append(input('d', ' on', 200, 400))
    expect(t.messages().map(g => [g.role, g.text])).toEqual([
        ['user', 'Book on Friday.'],
        ['assistant', 'Sure.'],
    ])
    expect(t.revision).toBe(3)
    expect(t.fragments).toHaveLength(4)
})

test('late prefix fragments keep the persisted group identity', () => {
    const transcript = createLiveTranscript()
    const event = (id, text, start, end) => ({
        type: 'session.input_transcript.delta',
        event_id: id,
        delta: text,
        start_ms: start,
        end_ms: end,
    })
    transcript.append(event('first-seen', ' tomorrow', 200, 400))
    expect(transcript.messages()[0].id).toBe('first-seen')
    transcript.append(event('late-prefix', 'Do it', 100, 200))
    expect(transcript.messages()).toHaveLength(1)
    expect(transcript.messages()[0]).toMatchObject({ id: 'first-seen', text: 'Do it tomorrow', start: 100 })
})
