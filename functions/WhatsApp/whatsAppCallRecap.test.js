const { EventEmitter } = require('events')
const { EMPTY_CALL_RECAP, RECAP_INSTRUCTIONS, generateCallRecap } = require('./whatsAppCallRecap')

function createFakeWebSocket({ response, errorEvent } = {}) {
    const instances = []

    class FakeWebSocket extends EventEmitter {
        static OPEN = 1

        constructor(url, options) {
            super()
            this.url = url
            this.options = options
            this.readyState = FakeWebSocket.OPEN
            this.sent = []
            instances.push(this)
            setImmediate(() => this.emit('open'))
        }

        send(payload) {
            const event = JSON.parse(payload)
            this.sent.push(event)
            if (event.type === 'session.update') {
                setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))))
            }
            if (event.type === 'response.create') {
                setImmediate(() => {
                    this.emit(
                        'message',
                        Buffer.from(
                            JSON.stringify(
                                errorEvent
                                    ? { type: 'error', error: errorEvent }
                                    : {
                                          type: 'response.done',
                                          response: response || {
                                              id: 'recap-response',
                                              status: 'completed',
                                              output: [
                                                  {
                                                      type: 'message',
                                                      content: [{ type: 'output_text', text: 'A useful recap.' }],
                                                  },
                                              ],
                                              usage: { total_tokens: 42 },
                                          },
                                      }
                            )
                        )
                    )
                })
            }
        }

        close() {
            this.readyState = 3
        }
    }

    return { FakeWebSocket, instances }
}

describe('WhatsApp call recap', () => {
    const config = {
        openAiApiKey: 'key',
        realtimeModel: 'gpt-realtime-2',
        reasoningEffort: 'medium',
    }

    test('generates a text-only Realtime recap with tools disabled', async () => {
        const { FakeWebSocket, instances } = createFakeWebSocket()

        await expect(
            generateCallRecap(
                config,
                { userId: 'user-1' },
                [
                    { role: 'user', text: 'Please create a reminder.' },
                    { role: 'assistant', text: 'I created it.' },
                ],
                { WebSocketImpl: FakeWebSocket }
            )
        ).resolves.toEqual({
            text: 'A useful recap.',
            tokens: 42,
            responseId: 'recap-response',
        })

        const socket = instances[0]
        expect(socket.url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-2')
        expect(socket.options.headers.Authorization).toBe('Bearer key')
        expect(socket.options.headers['OpenAI-Safety-Identifier']).not.toContain('user-1')
        expect(socket.sent[0]).toEqual({
            type: 'session.update',
            session: {
                type: 'realtime',
                model: 'gpt-realtime-2',
                output_modalities: ['text'],
                instructions: RECAP_INSTRUCTIONS,
                reasoning: { effort: 'medium' },
                tools: [],
            },
        })
        expect(socket.sent[1]).toEqual(
            expect.objectContaining({
                type: 'response.create',
                response: expect.objectContaining({
                    conversation: 'none',
                    output_modalities: ['text'],
                }),
            })
        )
    })

    test('returns the completion fallback when no transcript exists', async () => {
        const { FakeWebSocket, instances } = createFakeWebSocket()

        await expect(generateCallRecap(config, {}, [], { WebSocketImpl: FakeWebSocket })).resolves.toEqual({
            text: EMPTY_CALL_RECAP,
            tokens: 0,
        })
        expect(instances).toHaveLength(0)
    })

    test('returns a privacy-safe OpenAI error code', async () => {
        const { FakeWebSocket } = createFakeWebSocket({
            errorEvent: { code: 'model_not_found', message: 'Sensitive provider details' },
        })

        await expect(
            generateCallRecap(config, {}, [{ role: 'user', text: 'Hello' }], { WebSocketImpl: FakeWebSocket })
        ).rejects.toMatchObject({
            message: 'WhatsApp call recap generation failed',
            code: 'model_not_found',
        })
    })
})
