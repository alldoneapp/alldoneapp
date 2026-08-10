const {
    UNSUPPORTED_IMAGE_PLACEHOLDER,
    convertChatCompletionsStream,
    normalizeContentForChatCompletions,
    toChatCompletionsMessages,
} = require('./openRouterChatClient')

/** Turn a plain array into the async iterable the converter consumes, with no SDK or HTTP layer. */
async function* asStream(chunks) {
    for (const chunk of chunks) yield chunk
}

async function collect(stream) {
    const out = []
    for await (const item of stream) out.push(item)
    return out
}

function textDelta(content) {
    return { choices: [{ delta: { content } }] }
}

describe('toChatCompletionsMessages', () => {
    test('drops the internal promptCacheBreakpoint key that OpenAI-compatible APIs reject', () => {
        const messages = toChatCompletionsMessages([{ role: 'user', content: 'hi', promptCacheBreakpoint: true }])

        expect(messages).toEqual([{ role: 'user', content: 'hi' }])
        expect(messages[0]).not.toHaveProperty('promptCacheBreakpoint')
    })

    test('carries tool_calls and tool_call_id through so the tool loop can replay a round', () => {
        const toolCalls = [{ id: 'call_1', type: 'function', function: { name: 'create_task', arguments: '{}' } }]

        expect(
            toChatCompletionsMessages([
                { role: 'assistant', content: '', tool_calls: toolCalls },
                { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
            ])
        ).toEqual([
            { role: 'assistant', content: '', tool_calls: toolCalls },
            { role: 'tool', content: 'ok', tool_call_id: 'call_1' },
        ])
    })

    test('stringifies a non-string tool result, matching the Responses path', () => {
        const [message] = toChatCompletionsMessages([{ role: 'tool', tool_call_id: 'c1', content: { tasks: 2 } }])

        expect(message.content).toBe('{"tasks":2}')
    })

    test('accepts the legacy [role, content] tuple format', () => {
        expect(toChatCompletionsMessages([['system', 'be brief']])).toEqual([{ role: 'system', content: 'be brief' }])
    })

    test('rejects a message shape it cannot map instead of sending something wrong', () => {
        expect(() => toChatCompletionsMessages([{ content: 'no role' }])).toThrow('Unexpected message format')
        expect(() => toChatCompletionsMessages('not an array')).toThrow('Messages must be an array')
    })
})

describe('normalizeContentForChatCompletions', () => {
    test('replaces image parts for a text-only model rather than failing the whole request', () => {
        // DeepSeek V4 Flash reports `input_modalities: ['text']`. Sending it an image_url part is a
        // hard 400 that the user cannot diagnose, so the thread degrades to a readable note instead.
        const content = normalizeContentForChatCompletions([
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ])

        expect(content).toBe(`What is this?\n${UNSUPPORTED_IMAGE_PLACEHOLDER}`)
    })

    test('keeps image parts when the model can see them', () => {
        const parts = [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ]

        expect(normalizeContentForChatCompletions(parts, { supportsImages: true })).toEqual(parts)
    })

    test('collapses an all-text part list to a plain string', () => {
        // A string is universally accepted; the parts array is only reliably accepted on `user`.
        expect(
            normalizeContentForChatCompletions([
                { type: 'text', text: 'one' },
                { type: 'text', text: 'two' },
            ])
        ).toBe('one\ntwo')
    })

    test('passes plain string content through untouched', () => {
        expect(normalizeContentForChatCompletions('already a string')).toBe('already a string')
        expect(normalizeContentForChatCompletions(undefined)).toBe('')
    })
})

describe('convertChatCompletionsStream', () => {
    test('emits text deltas in the assistant stream contract', async () => {
        const events = await collect(convertChatCompletionsStream(asStream([textDelta('Hel'), textDelta('lo')])))

        expect(events).toEqual([
            { content: 'Hel', additional_kwargs: {} },
            { content: 'lo', additional_kwargs: {} },
        ])
    })

    test('reassembles a tool call split across delta fragments', async () => {
        // The first fragment carries id + name; later ones append arguments a few characters at a
        // time and omit the id entirely — which is why accumulation is keyed on `index`, not `id`.
        const events = await collect(
            convertChatCompletionsStream(
                asStream([
                    {
                        choices: [
                            {
                                delta: {
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: 'call_a',
                                            function: { name: 'create_task', arguments: '{"na' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"x"}' } }] } }] },
                    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
                ])
            )
        )

        expect(events).toEqual([
            {
                content: '',
                additional_kwargs: {
                    tool_calls: [
                        {
                            id: 'call_a',
                            type: 'function',
                            function: { name: 'create_task', arguments: '{"name":"x"}' },
                        },
                    ],
                },
            },
        ])
    })

    test('keeps parallel tool calls separate', async () => {
        const events = await collect(
            convertChatCompletionsStream(
                asStream([
                    {
                        choices: [
                            {
                                delta: {
                                    tool_calls: [
                                        { index: 0, id: 'a', function: { name: 'get_tasks', arguments: '{}' } },
                                        { index: 1, id: 'b', function: { name: 'get_notes', arguments: '{}' } },
                                    ],
                                },
                            },
                        ],
                    },
                ])
            )
        )

        expect(events[0].additional_kwargs.tool_calls.map(call => call.function.name)).toEqual([
            'get_tasks',
            'get_notes',
        ])
    })

    test('emits text before the trailing tool-call event when a turn has both', async () => {
        const events = await collect(
            convertChatCompletionsStream(
                asStream([
                    textDelta('Working on it.'),
                    {
                        choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'get_tasks' } }] } }],
                    },
                ])
            )
        )

        expect(events[0]).toEqual({ content: 'Working on it.', additional_kwargs: {} })
        expect(events[1].additional_kwargs.tool_calls).toHaveLength(1)
    })

    test('drops an argument fragment that never received a tool name', async () => {
        // Dispatching on an empty name would blow up the tool loop; reporting "empty response" is
        // the honest outcome.
        await expect(
            collect(
                convertChatCompletionsStream(
                    asStream([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] }])
                )
            )
        ).rejects.toThrow('OpenRouter returned an empty response')
    })

    test('surfaces a mid-stream provider error instead of returning a truncated answer', async () => {
        // OpenRouter forwards upstream failures as an `error` member on an otherwise valid chunk,
        // so a 200 response can still fail partway through.
        await expect(
            collect(
                convertChatCompletionsStream(
                    asStream([textDelta('partial'), { error: { message: 'upstream provider is down' } }])
                )
            )
        ).rejects.toThrow('upstream provider is down')
    })

    test('reports an empty completion rather than yielding nothing', async () => {
        await expect(
            collect(convertChatCompletionsStream(asStream([{ choices: [{ delta: {}, finish_reason: 'length' }] }])))
        ).rejects.toThrow('finish_reason: length')
    })

    test('tolerates a usage-only final chunk, which carries no choices', async () => {
        const events = await collect(
            convertChatCompletionsStream(
                asStream([
                    textDelta('done'),
                    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
                ])
            )
        )

        expect(events).toEqual([{ content: 'done', additional_kwargs: {} }])
    })
})
