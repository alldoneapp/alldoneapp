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

    test('counts replaced image parts so a dropped image leaves a trace', () => {
        // Without the count a dropped image is invisible: the request succeeds and the only symptom
        // is an answer that ignores the attachment the user is looking at.
        const stats = { strippedImageParts: 0 }
        normalizeContentForChatCompletions(
            [
                { type: 'text', text: 'What is this?' },
                { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
                { type: 'image_url', image_url: { url: 'https://example.com/b.png' } },
            ],
            { stats }
        )

        expect(stats.strippedImageParts).toBe(2)
    })

    test('tells the model that fetching the image with a tool will not help', () => {
        // get_chat_attachment can now return an image's bytes, which a text-only model still cannot
        // see. Saying so stops the tool loop that burned a minute of the user's time.
        expect(UNSUPPORTED_IMAGE_PLACEHOLDER).toMatch(/tool will not make it viewable/i)
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

    test('surfaces a max-token finish as a control chunk so the UI is not silently truncated', async () => {
        const events = await collect(
            convertChatCompletionsStream(
                asStream([
                    textDelta('Unfortunately the answer stops right'),
                    { choices: [{ delta: {}, finish_reason: 'length' }] },
                ])
            )
        )

        expect(events).toEqual([
            { content: 'Unfortunately the answer stops right', additional_kwargs: {} },
            { content: '', finishReason: 'length', additional_kwargs: {} },
        ])
    })
})

describe('streamOpenRouterChat retries a transiently broken stream (AT-2870)', () => {
    const { streamOpenRouterChat } = require('./openRouterChatClient')
    const { APIError, BadRequestError } = require('openai')

    // Exactly what the SDK throws for an OpenRouter error event inside an HTTP 200 stream: no
    // status, the provider's code, the provider's message verbatim — the wiki run of 2026-10-26.
    const lostConnection = () => new APIError(undefined, { code: 502, message: 'Network connection lost.' })

    /** A raw chunk stream that yields `chunks` and then, if given, fails with `error`. */
    function rawStream(chunks, error = null) {
        return (async function* () {
            for (const chunk of chunks) yield chunk
            if (error) throw error
        })()
    }

    const toolCallChunk = {
        choices: [
            {
                delta: {
                    tool_calls: [
                        { index: 0, id: 'call_1', function: { name: 'write_page', arguments: '{"slug":"a"}' } },
                    ],
                },
                finish_reason: 'tool_calls',
            },
        ],
    }

    function fakeClient(...attempts) {
        const create = jest.fn(async () => {
            const next = attempts.shift()
            if (!next) throw new Error('unexpected extra request')
            if (next instanceof Error) throw next
            return next
        })
        return { client: { chat: { completions: { create } } }, create }
    }

    let warnLog
    let infoLog
    beforeEach(() => {
        warnLog = jest.spyOn(console, 'warn').mockImplementation(() => {})
        infoLog = jest.spyOn(console, 'log').mockImplementation(() => {})
    })
    afterEach(() => {
        warnLog.mockRestore()
        infoLog.mockRestore()
    })

    const open = (client, options = {}) =>
        streamOpenRouterChat({
            client,
            model: 'deepseek/deepseek-v4-flash',
            messages: [['user', 'hi']],
            sleep: options.sleep || jest.fn(async () => {}),
            ...options,
        })

    test('re-requests a stream that broke off before the consumer saw anything', async () => {
        const { client, create } = fakeClient(rawStream([], lostConnection()), rawStream([toolCallChunk]))
        const sleep = jest.fn(async () => {})

        const events = await collect(await open(client, { sleep }))

        expect(create).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledTimes(1)
        expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000)
        expect(sleep.mock.calls[0][0]).toBeLessThan(2000)
        // One tool call, once: the broken attempt never got as far as emitting one.
        expect(events).toEqual([
            {
                content: '',
                additional_kwargs: {
                    tool_calls: [
                        { id: 'call_1', type: 'function', function: { name: 'write_page', arguments: '{"slug":"a"}' } },
                    ],
                },
            },
        ])
    })

    test('does not replay a stream whose text the consumer already received', async () => {
        // Interactive chat: the text has gone to the user, a replay would print it twice.
        const { client, create } = fakeClient(rawStream([textDelta('Hal')], lostConnection()))

        const received = []
        await expect(
            (async () => {
                for await (const event of await open(client)) received.push(event.content)
            })()
        ).rejects.toThrow('Network connection lost.')

        expect(received).toEqual(['Hal'])
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('with bufferOutput retries wherever the stream broke off, and hands over only the complete answer', async () => {
        const { client, create } = fakeClient(
            rawStream([textDelta('Halb fertig')], lostConnection()),
            rawStream([textDelta('Ganz '), textDelta('fertig'), toolCallChunk])
        )

        const events = await collect(await open(client, { bufferOutput: true }))

        expect(create).toHaveBeenCalledTimes(2)
        expect(events.map(event => event.content)).toEqual(['Ganz ', 'fertig', ''])
        expect(events.filter(event => event.additional_kwargs.tool_calls)).toHaveLength(1)
    })

    test('gives up after the bounded number of retries and reports the original error', async () => {
        const { client, create } = fakeClient(
            rawStream([], lostConnection()),
            rawStream([], lostConnection()),
            rawStream([], lostConnection())
        )
        const sleep = jest.fn(async () => {})

        await expect(collect(await open(client, { sleep }))).rejects.toThrow('Network connection lost.')

        expect(create).toHaveBeenCalledTimes(3)
        expect(sleep).toHaveBeenCalledTimes(2)
    })

    test('retries a mid-stream event that arrives as a raw chunk, keeping its code', async () => {
        const { client, create } = fakeClient(
            rawStream([{ error: { code: 502, message: 'Network connection lost.' } }]),
            rawStream([textDelta('ok')])
        )

        const events = await collect(await open(client))

        expect(create).toHaveBeenCalledTimes(2)
        expect(events).toEqual([{ content: 'ok', additional_kwargs: {} }])
    })

    test.each([
        [
            'a permanent mid-stream code (out of credits)',
            () => new APIError(undefined, { code: 402, message: 'Insufficient credits' }),
        ],
        ['an empty answer cut off by the token limit', null],
    ])('does not retry %s', async (_label, makeError) => {
        const first = makeError
            ? rawStream([], makeError())
            : rawStream([{ choices: [{ delta: {}, finish_reason: 'length' }] }])
        const { client, create } = fakeClient(first)

        await expect(collect(await open(client))).rejects.toThrow()
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('does not retry once the caller has aborted', async () => {
        const controller = new AbortController()
        const { client, create } = fakeClient(
            (async function* () {
                controller.abort()
                throw lostConnection()
            })()
        )

        await expect(collect(await open(client, { signal: controller.signal }))).rejects.toThrow()
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('a request that cannot be opened still throws from the call itself', async () => {
        const refused = new BadRequestError(400, { message: 'bad model' }, undefined, new Headers())
        const { client, create } = fakeClient(refused)

        await expect(open(client)).rejects.toBe(refused)
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('maxStreamRetries 0 turns retrying off', async () => {
        const { client, create } = fakeClient(rawStream([], lostConnection()))

        await expect(collect(await open(client, { maxStreamRetries: 0 }))).rejects.toThrow('Network connection lost.')
        expect(create).toHaveBeenCalledTimes(1)
    })
})
