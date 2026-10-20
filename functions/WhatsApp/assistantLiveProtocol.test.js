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
